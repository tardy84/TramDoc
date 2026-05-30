import AdmZip from 'adm-zip';
import { parseString } from 'xml2js';
import { promisify } from 'util';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import * as cheerio from 'cheerio';

const parseXml = promisify(parseString);
const prisma = new PrismaClient({});

type SegmentRole = 'narrator' | 'heading';

export class EpubProcessor {
    /**
     * Main method to process an uploaded EPUB file
     */
    async processEpub(filePath: string, onProgress?: (progress: number, status: string) => void): Promise<number> {
        onProgress?.(5, 'Extracting EPUB structure...');
        const zip = new AdmZip(filePath);
        const zipEntries = zip.getEntries();
        const zipEntryMap = new Map(zipEntries.map(entry => [entry.entryName, entry]));

        // 1. Find and parse container.xml to locate content.opf
        const containerEntry = zipEntryMap.get('META-INF/container.xml') ||
            zipEntries.find(e => e.entryName.endsWith('container.xml'));
        if (!containerEntry) throw new Error('Invalid EPUB: container.xml not found');

        const containerXml: any = await parseXml(containerEntry.getData().toString('utf8'));
        const rootfilePath = containerXml.container.rootfiles[0].rootfile[0].$['full-path'];

        // 2. Parse OPF file for metadata
        const opfEntry = zipEntryMap.get(rootfilePath);
        if (!opfEntry) throw new Error('content.opf not found');
        const opfXml: any = await parseXml(opfEntry.getData().toString('utf8'));

        const metadata = opfXml.package.metadata[0];
        onProgress?.(10, 'Reading book metadata...');

        // Handle title field
        let title = 'Unknown Title';
        const titleField = metadata['dc:title']?.[0];
        title = typeof titleField === 'string' ? titleField : (titleField?._ || String(titleField || title));

        // Handle author field
        let author = 'Unknown';
        const authorField = metadata['dc:creator']?.[0];
        author = typeof authorField === 'string' ? authorField : (authorField?._ || String(authorField || author));

        // 3. Extract cover image
        let coverImagePath: string | undefined;
        try {
            coverImagePath = await this.extractCoverImage(zip, zipEntries, opfXml, path.posix.dirname(rootfilePath));
        } catch (error) {
            console.warn('[EPUB] Failed to extract cover image:', error);
        }

        onProgress?.(15, 'Creating book record...');

        // 4. Create book record in database
        const book = await prisma.book.create({
            data: {
                title,
                author,
                coverImagePath,
            },
        });

        try {
            // 5. Get spine (reading order)
            const spine = opfXml.package.spine[0].itemref;
            const manifest = opfXml.package.manifest[0].item;

            // 6. Process each chapter
            const opfDir = path.posix.dirname(rootfilePath);
            const chapterTitleByHref = await this.buildChapterTitleMap(zipEntryMap, opfXml, opfDir);
            const totalChapters = spine.length;
            let processedChapters = 0;

            for (let i = 0; i < spine.length; i++) {
                const idref = spine[i].$.idref;
                if (spine[i].$.linear === 'no') continue;

                const manifestItem = manifest.find((item: any) => item.$.id === idref);
                if (!manifestItem || !this.isHtmlManifestItem(manifestItem)) continue;

                const chapterPath = this.resolveEpubHref(opfDir, manifestItem.$.href);
                if (!chapterPath) continue;

                const chapterEntry = zipEntryMap.get(chapterPath);
                if (!chapterEntry) continue;

                const chapterHtml = chapterEntry.getData().toString('utf8');
                const chapterTitle = chapterTitleByHref.get(chapterPath) ||
                    this.extractChapterTitle(chapterHtml, title, author) ||
                    `Chapter ${i + 1}`;
                const isTableOfContents = this.detectTableOfContents(chapterTitle);

                // Process chapter sequentially to avoid database deadlocks and maintain order
                const didCreateChapter = await this.processChapter(
                    book.id,
                    chapterTitle,
                    chapterHtml,
                    i,
                    isTableOfContents,
                    title,
                    author
                );
                if (!didCreateChapter) continue;

                processedChapters++;
                const chapterProgress = 20 + Math.floor((processedChapters / totalChapters) * 75);
                onProgress?.(chapterProgress, `Processed ${processedChapters}/${totalChapters} chapters...`);
            }
        } catch (error) {
            await prisma.book.delete({ where: { id: book.id } }).catch((deleteError) => {
                console.warn(`[EPUB] Failed to clean up partial book ${book.id}:`, deleteError);
            });
            throw error;
        }

        onProgress?.(100, 'Finishing up...');
        console.log(`[EPUB] 🎉 Finished processing book: ${title}`);
        return book.id;
    }

    /**
     * Extract cover image from EPUB and save to disk
     */
    private async extractCoverImage(
        zip: AdmZip,
        zipEntries: AdmZip.IZipEntry[],
        opfXml: any,
        opfDir: string
    ): Promise<string | undefined> {
        const fs = await import('fs/promises');
        const manifest = opfXml.package.manifest[0].item;

        const metadata = opfXml.package.metadata[0];
        const coverMeta = metadata.meta?.find((m: any) =>
            m.$?.name === 'cover' || m.$?.property === 'cover-image'
        );

        let coverItem;
        if (coverMeta) {
            const coverId = coverMeta.$.content || coverMeta.$['refines'];
            coverItem = manifest.find((item: any) => item.$.id === coverId);
        }

        if (!coverItem) {
            coverItem = manifest.find((item: any) =>
                item.$.properties?.includes('cover-image') ||
                item.$.id?.toLowerCase().includes('cover')
            );
        }

        if (!coverItem) {
            coverItem = manifest.find((item: any) => {
                const href = item.$.href.toLowerCase();
                return href.includes('cover') &&
                    (href.endsWith('.jpg') || href.endsWith('.jpeg') || href.endsWith('.png'));
            });
        }

        if (!coverItem) throw new Error('Cover image not found');

        const coverPath = this.resolveEpubHref(opfDir, coverItem.$.href);
        const entryMap = new Map(zipEntries.map(entry => [entry.entryName, entry]));
        const coverEntry = coverPath ? entryMap.get(coverPath) : undefined;
        if (!coverEntry) throw new Error(`File not found: ${coverPath}`);

        const ext = path.extname(this.stripHrefFragmentAndQuery(coverItem.$.href));
        const fileName = `cover_${Date.now()}${ext}`;
        const savePath = path.join('uploads', 'covers', fileName);

        await fs.mkdir(path.dirname(savePath), { recursive: true });
        await fs.writeFile(savePath, coverEntry.getData());
        return savePath;
    }

    private async buildChapterTitleMap(
        zipEntryMap: Map<string, AdmZip.IZipEntry>,
        opfXml: any,
        opfDir: string
    ): Promise<Map<string, string>> {
        const titleByHref = new Map<string, string>();
        const manifest = opfXml.package.manifest[0].item || [];

        const addTitle = (baseDir: string, src: string | undefined, text: string | undefined) => {
            const cleanTitle = this.normalizeBlockText(text || '').replace(/\n+/g, ' ');
            if (!src || !cleanTitle || cleanTitle.length > 160) return;

            const href = this.resolveEpubHref(baseDir, src);
            if (!href || titleByHref.has(href)) return;
            titleByHref.set(href, cleanTitle);
        };

        for (const item of manifest) {
            const href = item.$?.href;
            const mediaType = item.$?.['media-type']?.toLowerCase();
            const properties = item.$?.properties?.toLowerCase() || '';
            const id = item.$?.id?.toLowerCase() || '';
            const isNcx = mediaType === 'application/x-dtbncx+xml' || href?.toLowerCase().endsWith('.ncx') || id === 'ncx';
            const isNav = properties.split(/\s+/).includes('nav') && this.isHtmlManifestItem(item);

            const navPath = this.resolveEpubHref(opfDir, href || '');
            if (!navPath) continue;
            const navEntry = zipEntryMap.get(navPath);
            if (!navEntry) continue;

            try {
                const navDir = path.posix.dirname(navPath);
                if (isNcx) {
                    const ncxXml: any = await parseXml(navEntry.getData().toString('utf8'));
                    this.collectNcxNavTitles(ncxXml?.ncx?.navMap?.[0]?.navPoint || [], (src, text) => addTitle(navDir, src, text));
                } else if (isNav) {
                    this.collectHtmlNavTitles(navEntry.getData().toString('utf8'), (src, text) => addTitle(navDir, src, text));
                }
            } catch (error) {
                console.warn(`[EPUB] Failed to parse navigation titles from ${navPath}:`, error);
            }
        }

        return titleByHref;
    }

    private collectNcxNavTitles(navPoints: any[], addTitle: (src?: string, text?: string) => void): void {
        for (const point of navPoints || []) {
            addTitle(point?.content?.[0]?.$?.src, point?.navLabel?.[0]?.text?.[0]);
            this.collectNcxNavTitles(point?.navPoint || [], addTitle);
        }
    }

    private collectHtmlNavTitles(html: string, addTitle: (src?: string, text?: string) => void): void {
        const $ = cheerio.load(html);
        const tocLinks = $('nav a[href], [role="doc-toc"] a[href], [epub\\:type~="toc"] a[href]');
        const links = tocLinks.length > 0 ? tocLinks : $('a[href]');

        links.each((_, el) => {
            const $el = $(el);
            addTitle($el.attr('href'), $el.text());
        });
    }

    /**
     * Extract chapter title from HTML using Cheerio
     * Improved to filter out author names and prioritize "Chapter/Chương" patterns
     */
    private extractChapterTitle(html: string, bookTitle: string, author?: string): string | null {
        const $ = cheerio.load(html);
        const bookTitleNormalized = bookTitle.trim().toLowerCase();
        const authorNormalized = author?.trim().toLowerCase();

        // Collect candidates
        const candidates: string[] = [];
        $('h1, h2, h3, p').slice(0, 8).each((_, el) => {
            const text = $(el).text().trim().replace(/\s+/g, ' ');
            if (text && text.length > 0 && text.length < 100) {
                const lowText = text.toLowerCase();
                // Skip if matches book title or author
                if (lowText === bookTitleNormalized) return;
                if (authorNormalized && lowText === authorNormalized) return;
                // Skip if it contains only metadata
                if (lowText.includes('trang ') || lowText.includes('page ')) return;

                candidates.push(text);
            }
            if (text.length > 200) return false;
        });

        if (candidates.length === 0) return null;

        // Pattern matching for "Chương X", "Chapter X", "Phần X"
        const chapterPattern = /^(chương|chapter|phần|tiết|lời|mục lục)\s+/i;
        const priorityCandidate = candidates.find(c => chapterPattern.test(c));
        if (priorityCandidate) return priorityCandidate;

        // If we have "1" followed by "Title", combine them
        if (candidates.length >= 2 && candidates[0].length < 10 && !isNaN(parseInt(candidates[0]))) {
            return `${candidates[0]} - ${candidates[1]}`;
        }

        return candidates[0];
    }

    /**
     * Detect if chapter is Table of Contents
     */
    private detectTableOfContents(title: string): boolean {
        const lowerTitle = title.toLowerCase();
        return ['mục lục', 'contents', 'toc', 'muc luc', '目录'].some(p => lowerTitle.includes(p));
    }

    private isHtmlManifestItem(manifestItem: any): boolean {
        const mediaType = manifestItem.$?.['media-type']?.toLowerCase();
        if (mediaType === 'application/xhtml+xml' || mediaType === 'text/html') return true;

        const href = this.stripHrefFragmentAndQuery(manifestItem.$?.href || '').toLowerCase();
        return href.endsWith('.xhtml') || href.endsWith('.html') || href.endsWith('.htm');
    }

    private resolveEpubHref(baseDir: string, href: string): string | null {
        const cleanHref = this.stripHrefFragmentAndQuery(href).replace(/\\/g, '/');
        if (!cleanHref) return null;

        const decodedHref = this.decodeUriSafely(cleanHref);
        const normalized = path.posix.normalize(path.posix.join(baseDir, decodedHref));

        if (normalized === '.' || normalized.startsWith('../') || path.posix.isAbsolute(normalized)) {
            return null;
        }

        return normalized;
    }

    private stripHrefFragmentAndQuery(href: string): string {
        return href.split('#')[0].split('?')[0].trim();
    }

    private decodeUriSafely(value: string): string {
        try {
            return decodeURIComponent(value);
        } catch {
            return value;
        }
    }

    /**
     * Process a single chapter: extract semantic segments using Cheerio
     */
    private async processChapter(
        bookId: number,
        chapterTitle: string,
        html: string,
        chapterIndex: number,
        isTableOfContents: boolean,
        bookTitle: string,
        author?: string
    ): Promise<boolean> {
        const { segmentTexts, segmentRoles } = this.extractSegments(html, chapterTitle, bookTitle, author);
        if (isTableOfContents || this.isTableOfContentsDocument(segmentTexts)) {
            return false;
        }
        if (this.isLowValueReadingDocument(segmentTexts, segmentRoles, bookTitle, author)) {
            return false;
        }

        const chapter = await prisma.chapter.create({
            data: {
                title: chapterTitle,
                bookId,
                orderIndex: chapterIndex,
                isTableOfContents,
            },
        });

        const segmentData = segmentTexts.map((content, i) => ({
            content,
            role: segmentRoles[i] as any,
            chapterId: chapter.id,
            orderIndex: i,
        }));

        await prisma.textSegment.createMany({
            data: segmentData,
        });

        return true;
    }

    private extractSegments(
        html: string,
        chapterTitle: string,
        bookTitle: string,
        author?: string
    ): { segmentTexts: string[]; segmentRoles: SegmentRole[] } {
        const $ = cheerio.load(html);

        // Remove noise
        $('script, style, link, iFrame, iframe, img, svg, audio, video, aside, nav').remove();
        $('[class], [id], [role], [aria-label], [epub\\:type]').filter((_, el) => {
            const $el = $(el);
            const marker = [
                $el.attr('class'),
                $el.attr('id'),
                $el.attr('role'),
                $el.attr('aria-label'),
                $el.attr('epub:type'),
            ].filter(Boolean).join(' ').toLowerCase();

            return /\b(pagebreak|page-break|pagenum|page-num|page_number|footnote|endnote|noteref|nav|navigation|toc|aside|decorative)\b/.test(marker);
        }).remove();
        $('br').replaceWith('\n');

        const segmentTexts: string[] = [];
        const segmentRoles: SegmentRole[] = [];
        const semanticSelector = 'h1, h2, h3, h4, h5, h6, p, li, blockquote';
        const semanticBlocks = $('body').find(semanticSelector);
        const leafDivBlocks = $('body').find('div').filter((_, el) =>
            $(el).find('div, h1, h2, h3, h4, h5, h6, p, li, blockquote').length === 0
        );
        const semanticTextLength = semanticBlocks.toArray()
            .map(el => this.normalizeBlockText($(el).text()).length)
            .reduce((total, length) => total + length, 0);
        const leafDivTextLength = leafDivBlocks.toArray()
            .map(el => this.normalizeBlockText($(el).text()).length)
            .reduce((total, length) => total + length, 0);
        const blocks = semanticBlocks.length === 0 || (semanticTextLength < 300 && leafDivTextLength > semanticTextLength)
            ? semanticBlocks.add(leafDivBlocks)
            : semanticBlocks;

        blocks.each((_, el) => {
            const $el = $(el);
            const isHeading = $el.is('h1, h2, h3, h4, h5, h6');

            // Skip semantic containers with nested semantic content to avoid duplicate text.
            if ($el.is('li, blockquote') && $el.find(semanticSelector).length > 0) return;

            const text = this.normalizeBlockText($el.text());
            if (!text || text.length < 2) return;
            if (this.isDecorativeSeparator(text)) return;

            const textParts = text.split(/\n+/).map(part => part.trim()).filter(Boolean);

            textParts.forEach((part) => {
                if (this.isDecorativeSeparator(part)) return;

                this.splitIntoSentences(part).forEach((s) => {
                    if (this.isDecorativeSeparator(s)) return;
                    if (this.isBookMetadataText(s, bookTitle, author)) return;
                    segmentTexts.push(s);
                    segmentRoles.push(isHeading ? 'heading' : 'narrator');
                });
            });
        });

        return this.deduplicateRepeatedShortNoise(segmentTexts, segmentRoles, chapterTitle, bookTitle, author);
    }

    private normalizeBlockText(text: string): string {
        return text
            .replace(/\u00a0/g, ' ')
            .replace(/\r\n?/g, '\n')
            .replace(/[ \t\f\v]+/g, ' ')
            .replace(/[ \t]*\n[ \t]*/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    private isDecorativeSeparator(text: string): boolean {
        const normalized = text.trim();
        if (!normalized) return true;
        if (/^(?:[-–—_*~•·\s]){3,}$/.test(normalized)) return true;
        if (/^(?:[-–—_*~•·\s]*o+[-–—_*~•·\s]*){2,}$/i.test(normalized)) return true;
        return false;
    }

    private deduplicateRepeatedShortNoise(
        segmentTexts: string[],
        segmentRoles: SegmentRole[],
        chapterTitle: string,
        bookTitle: string,
        author?: string
    ): { segmentTexts: string[]; segmentRoles: SegmentRole[] } {
        const counts = new Map<string, number>();
        const seen = new Set<string>();
        const normalizedChapterTitle = this.normalizeForComparison(chapterTitle);

        segmentTexts.forEach((text) => {
            const normalized = this.normalizeForComparison(text);
            if (this.isShortDedupCandidate(text, normalized, normalizedChapterTitle)) {
                counts.set(normalized, (counts.get(normalized) || 0) + 1);
            }
        });

        const dedupedTexts: string[] = [];
        const dedupedRoles: SegmentRole[] = [];

        segmentTexts.forEach((text, index) => {
            const role = segmentRoles[index];
            const normalized = this.normalizeForComparison(text);
            const count = counts.get(normalized) || 0;
            const isRepeatedNoise = count > 1 && (
                this.isBookMetadataText(text, bookTitle, author) ||
                (count >= 3 && role !== 'heading')
            );

            if (isRepeatedNoise) {
                if (seen.has(normalized)) return;
                seen.add(normalized);
            }

            dedupedTexts.push(text);
            dedupedRoles.push(role);
        });

        return { segmentTexts: dedupedTexts, segmentRoles: dedupedRoles };
    }

    private isShortDedupCandidate(text: string, normalizedText: string, normalizedChapterTitle: string): boolean {
        if (!normalizedText || text.length > 80) return false;
        if (normalizedText === normalizedChapterTitle) return false;
        if (/^(chuong|chapter|phan|loi|hoi|muc)\b/.test(normalizedText)) return false;
        return true;
    }

    private isLowValueReadingDocument(
        segmentTexts: string[],
        segmentRoles: SegmentRole[],
        bookTitle: string,
        author?: string
    ): boolean {
        if (segmentTexts.length === 0) return true;
        if (this.isPromotionalDocument(segmentTexts)) return true;
        if (this.isPublicationMetadataDocument(segmentTexts)) return true;
        if (segmentTexts.length > 8) return false;

        const nonMetaSegments = segmentTexts
            .map((text, index) => ({ text, role: segmentRoles[index] }))
            .filter(({ text }) => !this.isBookMetadataText(text, bookTitle, author));
        const nonMetaNarratorChars = nonMetaSegments
            .filter(({ role }) => role === 'narrator')
            .reduce((total, { text }) => total + text.length, 0);

        if (nonMetaSegments.length === 0) return true;
        if (nonMetaSegments.reduce((total, { text }) => total + text.length, 0) < 80 && nonMetaNarratorChars === 0) {
            return true;
        }

        return false;
    }

    private isPromotionalDocument(segmentTexts: string[]): boolean {
        const normalizedStart = this.normalizeForComparison(segmentTexts.slice(0, 12).join(' '));
        return [
            'chao mung cac ban don doc dau sach tu du an sach cho thiet bi di dong',
            'thong tin ebook',
            'thank you for downloading this simon schuster ebook',
            'get a free ebook when you join our mailing list',
            'click here to sign up',
            'vh project',
            'du an che ban ebook',
            'ebook duoc thuc hien boi',
            'thu vien ebook',
        ].some(phrase => normalizedStart.includes(phrase));
    }

    private isPublicationMetadataDocument(segmentTexts: string[]): boolean {
        if (segmentTexts.length > 8) return false;

        const normalizedStart = this.normalizeForComparison(segmentTexts.join(' '));
        const hasPublisherMarker = [
            'nha xuat ban',
            'cong ty van hoa truyen thong',
            'all rights reserved',
            'copyright',
            'isbn',
        ].some(phrase => normalizedStart.includes(phrase));
        if (!hasPublisherMarker) return false;

        const proseLikeSegments = segmentTexts.filter(text =>
            text.length >= 120 && /[.!?…]["'”’)\]]?$/.test(text.trim())
        );
        return proseLikeSegments.length === 0;
    }

    private isTableOfContentsDocument(segmentTexts: string[]): boolean {
        const firstSegment = this.normalizeForComparison(segmentTexts[0] || '');
        return firstSegment === 'muc luc' || firstSegment === 'contents' || firstSegment === 'table of contents';
    }

    private isBookMetadataText(text: string, bookTitle: string, author?: string): boolean {
        const normalizedText = this.normalizeForComparison(text);
        const normalizedTitle = this.normalizeForComparison(bookTitle);
        const normalizedAuthor = author ? this.normalizeForComparison(author) : '';

        if (!normalizedText) return true;
        if (normalizedText === normalizedTitle || normalizedText === normalizedAuthor) return true;
        if (normalizedTitle && normalizedText.replaceAll(normalizedTitle, '').trim().length === 0) return true;
        if (normalizedAuthor && normalizedText.replaceAll(normalizedAuthor, '').trim().length === 0) return true;

        if (['cover', 'title page', 'bia sach', 'trang bia'].includes(normalizedText)) return true;
        return [
            'ebook mien phi tai',
            'sachvui com',
        ].some(phrase => normalizedText.includes(phrase));
    }

    private normalizeForComparison(value: string): string {
        return value
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/đ/g, 'd')
            .replace(/Đ/g, 'D')
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    /**
     * Split text into sentences intelligently and group them into logical chunks
     * Target chunk size is ~300 characters for optimal TTS naturalness and UX latency.
     */
    private splitIntoSentences(text: string): string[] {
        const sentences = this.extractSentenceUnits(text)
            .flatMap(sentence => this.hardSplitLongSentence(sentence));

        const MIN_CHUNK_LENGTH = 220;
        const MAX_CHUNK_LENGTH = 420;
        const chunks: string[] = [];
        let currentChunk = '';

        for (const sentence of sentences) {
            if (!currentChunk) {
                currentChunk = sentence;
                continue;
            }

            if (currentChunk.length + sentence.length + 1 > MAX_CHUNK_LENGTH) {
                chunks.push(currentChunk.trim());
                currentChunk = sentence;
            } else {
                currentChunk += ' ' + sentence;
            }

            if (currentChunk.length >= MIN_CHUNK_LENGTH && /[.!?…]["'”’)\]]?$/.test(currentChunk)) {
                chunks.push(currentChunk.trim());
                currentChunk = '';
            }
        }

        if (currentChunk) {
            chunks.push(currentChunk.trim());
        }

        return chunks;
    }

    private extractSentenceUnits(text: string): string[] {
        const normalized = text.trim().replace(/\s+/g, ' ');
        if (!normalized) return [];

        const sentences: string[] = [];
        let start = 0;

        for (let i = 0; i < normalized.length; i++) {
            if (!'.!?…'.includes(normalized[i])) continue;
            if (normalized[i] === '.' && this.isProtectedAbbreviation(normalized, i)) continue;

            let end = i + 1;
            while (end < normalized.length && /["'”’)\]]/.test(normalized[end])) {
                end++;
            }

            const next = normalized[end];
            if (next && !/\s/.test(next)) continue;

            const sentence = normalized.slice(start, end).trim();
            if (sentence) sentences.push(sentence);
            start = end;
        }

        const remainder = normalized.slice(start).trim();
        if (remainder) sentences.push(remainder);

        return sentences;
    }

    private isProtectedAbbreviation(text: string, periodIndex: number): boolean {
        const prefix = text.slice(0, periodIndex + 1);
        const abbreviationPatterns = [
            /\bv\.v\.$/i,
            /\bTS\.$/,
            /\bThS\.$/,
            /\bGS\.$/,
            /\bPGS\.$/,
            /\bTP\.HCM\.$/,
            /\bDr\.$/,
            /\bMr\.$/,
        ];

        return abbreviationPatterns.some(pattern => pattern.test(prefix));
    }

    private hardSplitLongSentence(sentence: string): string[] {
        const HARD_LIMIT = 700;
        if (sentence.length <= HARD_LIMIT) return [sentence];

        const chunks: string[] = [];
        let remaining = sentence.trim();

        while (remaining.length > HARD_LIMIT) {
            const window = remaining.slice(0, HARD_LIMIT);
            const splitIndex = Math.max(
                window.lastIndexOf(','),
                window.lastIndexOf(';'),
                window.lastIndexOf(':'),
                window.lastIndexOf(' - '),
                window.lastIndexOf(' – '),
                window.lastIndexOf(' — ')
            );
            const safeSplitIndex = splitIndex > 220 ? splitIndex + 1 : HARD_LIMIT;

            chunks.push(remaining.slice(0, safeSplitIndex).trim());
            remaining = remaining.slice(safeSplitIndex).trim();
        }

        if (remaining) chunks.push(remaining);
        return chunks;
    }
}
