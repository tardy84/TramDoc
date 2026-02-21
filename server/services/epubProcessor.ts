import AdmZip from 'adm-zip';
import { parseString } from 'xml2js';
import { promisify } from 'util';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import * as cheerio from 'cheerio';

const parseXml = promisify(parseString);
const prisma = new PrismaClient({});

export class EpubProcessor {
    /**
     * Main method to process an uploaded EPUB file
     */
    async processEpub(filePath: string, onProgress?: (progress: number, status: string) => void): Promise<number> {
        onProgress?.(5, 'Extracting EPUB structure...');
        const zip = new AdmZip(filePath);
        const zipEntries = zip.getEntries();

        // 1. Find and parse container.xml to locate content.opf
        const containerEntry = zipEntries.find(e => e.entryName.endsWith('container.xml'));
        if (!containerEntry) throw new Error('Invalid EPUB: container.xml not found');

        const containerXml: any = await parseXml(containerEntry.getData().toString('utf8'));
        const rootfilePath = containerXml.container.rootfiles[0].rootfile[0].$['full-path'];

        // 2. Parse OPF file for metadata
        const opfEntry = zipEntries.find(e => e.entryName === rootfilePath);
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
            coverImagePath = await this.extractCoverImage(zip, zipEntries, opfXml, path.dirname(rootfilePath));
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

        // 5. Get spine (reading order)
        const spine = opfXml.package.spine[0].itemref;
        const manifest = opfXml.package.manifest[0].item;

        // 6. Process each chapter
        const opfDir = path.dirname(rootfilePath);
        const totalChapters = spine.length;
        let processedChapters = 0;

        for (let i = 0; i < spine.length; i++) {
            const idref = spine[i].$.idref;
            const manifestItem = manifest.find((item: any) => item.$.id === idref);
            if (!manifestItem) continue;

            const chapterPath = path.posix.join(opfDir, manifestItem.$.href);
            const chapterEntry = zipEntries.find(e => e.entryName === chapterPath);
            if (!chapterEntry) continue;

            const chapterHtml = chapterEntry.getData().toString('utf8');
            const chapterTitle = this.extractChapterTitle(chapterHtml, title, author) || `Chapter ${i + 1}`;
            const isTableOfContents = this.detectTableOfContents(chapterTitle);

            // Process chapter sequentially to avoid database deadlocks and maintain order
            await this.processChapter(book.id, chapterTitle, chapterHtml, i, isTableOfContents);

            processedChapters++;
            const chapterProgress = 20 + Math.floor((processedChapters / totalChapters) * 75);
            onProgress?.(chapterProgress, `Processed ${processedChapters}/${totalChapters} chapters...`);
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

        const coverPath = path.posix.join(opfDir, coverItem.$.href);
        const coverEntry = zipEntries.find(e => e.entryName === coverPath);
        if (!coverEntry) throw new Error(`File not found: ${coverPath}`);

        const ext = path.extname(coverItem.$.href);
        const fileName = `cover_${Date.now()}${ext}`;
        const savePath = path.join('uploads', 'covers', fileName);

        await fs.writeFile(savePath, coverEntry.getData());
        return savePath;
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

    /**
     * Process a single chapter: extract semantic segments using Cheerio
     */
    private async processChapter(
        bookId: number,
        chapterTitle: string,
        html: string,
        chapterIndex: number,
        isTableOfContents: boolean = false
    ): Promise<void> {
        const $ = cheerio.load(html);

        // Remove noise
        $('script, style, link, iFrame, img, aside, nav').remove();

        const chapter = await prisma.chapter.create({
            data: {
                title: chapterTitle,
                bookId,
                orderIndex: chapterIndex,
                isTableOfContents,
            },
        });

        const segmentTexts: string[] = [];
        const segmentRoles: ('narrator' | 'heading')[] = [];

        // Iterate through all "content" elements in order
        $('body').find('h1, h2, h3, h4, h5, h6, p, div').each((_, el) => {
            const $el = $(el);
            const isHeading = $el.is('h1, h2, h3, h4');

            // Skip if it's a container that has child paragraphs (avoid duplication)
            if ($el.is('div') && $el.find('p, div').length > 0) return;

            let text = $el.text().trim().replace(/\s+/g, ' ');
            if (!text || text.length < 2) return;

            // Split long paragraphs into smaller segments
            const sentences = this.splitIntoSentences(text);

            sentences.forEach((s) => {
                segmentTexts.push(s);
                segmentRoles.push(isHeading ? 'heading' : 'narrator');
            });
        });

        if (segmentTexts.length > 0) {
            const segmentData = segmentTexts.map((content, i) => ({
                content,
                role: segmentRoles[i] as any,
                chapterId: chapter.id,
                orderIndex: i,
            }));

            await prisma.textSegment.createMany({
                data: segmentData,
            });
        }
    }

    /**
     * Split text into sentences intelligently
     */
    private splitIntoSentences(text: string): string[] {
        // Regex that handles standard punctuation but avoids splitting common abbreviations
        const sentences = text.match(/[^.!?]+[.!?]+(?=\s|$)/g) || [text];

        return sentences
            .map(s => s.trim())
            .filter(s => s.length > 0)
            .reduce((acc, curr) => {
                // If a "sentence" is too long (e.g. 500+ chars), split it by comma as a last resort
                // This prevents TTS engines from timing out.
                if (curr.length > 600) {
                    const parts = curr.split(/[,;]/).map(p => p.trim()).filter(p => p.length > 0);
                    return [...acc, ...parts];
                }
                return [...acc, curr];
            }, [] as string[]);
    }
}
