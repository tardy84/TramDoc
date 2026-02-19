import AdmZip from 'adm-zip';
import { parseString } from 'xml2js';
import { promisify } from 'util';
import path from 'path';
import { PrismaClient } from '@prisma/client';

const parseXml = promisify(parseString);
const prisma = new PrismaClient({});

interface TextSegment {
    content: string;
    role: 'narrator' | 'male' | 'female';
    orderIndex: number;
}

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

        // Handle title field - can be string or object
        let title = 'Unknown Title';
        const titleField = metadata['dc:title']?.[0];
        if (typeof titleField === 'string') {
            title = titleField;
        } else if (titleField && titleField._) {
            title = titleField._;
        } else if (titleField) {
            title = String(titleField);
        }

        // Handle author field - can be string or object
        let author = 'Unknown';
        const authorField = metadata['dc:creator']?.[0];
        if (typeof authorField === 'string') {
            author = authorField;
        } else if (authorField && authorField._) {
            author = authorField._;
        } else if (authorField) {
            author = String(authorField);
        }

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

        // 6. Process each chapter in parallel chunks to save time
        const opfDir = path.dirname(rootfilePath);
        const chapterPromises = [];
        const totalChapters = spine.length;
        let processedChapters = 0;

        for (let i = 0; i < spine.length; i++) {
            const idref = spine[i].$.idref;
            const manifestItem = manifest.find((item: any) => item.$.id === idref);
            if (!manifestItem) continue;

            const chapterPath = path.join(opfDir, manifestItem.$.href);
            const chapterEntry = zipEntries.find(e => e.entryName === chapterPath);
            if (!chapterEntry) continue;

            const chapterHtml = chapterEntry.getData().toString('utf8');
            const extractedTitle = this.extractChapterTitle(chapterHtml, title);
            const chapterTitle = extractedTitle || `Chapter ${i + 1}`;
            const isTableOfContents = this.detectTableOfContents(chapterTitle);

            // Create a wrapper to process the chapter
            const processWrapper = async () => {
                await this.processChapter(book.id, chapterTitle, chapterHtml, i, isTableOfContents);
                processedChapters++;
                const chapterProgress = 20 + Math.floor((processedChapters / totalChapters) * 75);
                onProgress?.(chapterProgress, `Processed ${processedChapters}/${totalChapters} chapters...`);
            };
            chapterPromises.push(processWrapper);
        }

        // Run all chapters in parallel - the global lock in RoleDetector will handle the rate limiting
        onProgress?.(20, `Analyzing ${totalChapters} chapters...`);
        await Promise.all(chapterPromises.map(p => p()));

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

        // Strategy 1: Look for cover in metadata
        const metadata = opfXml.package.metadata[0];
        const coverMeta = metadata.meta?.find((m: any) =>
            m.$?.name === 'cover' || m.$?.property === 'cover-image'
        );

        let coverItem;
        if (coverMeta) {
            const coverId = coverMeta.$.content || coverMeta.$['refines'];
            coverItem = manifest.find((item: any) => item.$.id === coverId);
        }

        // Strategy 2: Look for items with "cover" in properties or id
        if (!coverItem) {
            coverItem = manifest.find((item: any) =>
                item.$.properties?.includes('cover-image') ||
                item.$.id?.toLowerCase().includes('cover')
            );
        }

        // Strategy 3: Look for common cover image filenames
        if (!coverItem) {
            coverItem = manifest.find((item: any) => {
                const href = item.$.href.toLowerCase();
                return href.includes('cover') &&
                    (href.endsWith('.jpg') || href.endsWith('.jpeg') || href.endsWith('.png'));
            });
        }

        if (!coverItem) {
            throw new Error('Cover image not found in manifest');
        }

        // Extract cover image
        const coverPath = path.join(opfDir, coverItem.$.href);
        const coverEntry = zipEntries.find(e => e.entryName === coverPath);

        if (!coverEntry) {
            throw new Error(`Cover image file not found: ${coverPath}`);
        }

        // Save cover to uploads/covers/
        const ext = path.extname(coverItem.$.href);
        const fileName = `cover_${Date.now()}${ext}`;
        const savePath = path.join('uploads', 'covers', fileName);

        await fs.writeFile(savePath, coverEntry.getData());
        console.log(`[EPUB] Cover image saved to: ${savePath}`);

        return savePath;
    }

    /**
     * Extract chapter title from HTML
     * Enhanced to handle EPUBs where all chapters have the same book title
     */
    private extractChapterTitle(html: string, bookTitle: string): string | null {
        const normalizeTitle = (title: string) => title.trim().toLowerCase();
        const bookTitleNormalized = normalizeTitle(bookTitle);

        // Try to find <title> tag
        const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        if (titleMatch) {
            const title = titleMatch[1].trim();
            // Skip if it's the same as book title
            if (normalizeTitle(title) !== bookTitleNormalized) {
                return title;
            }
        }

        // Try to find first <h1> or <h2>
        const h1Match = html.match(/<h[12][^>]*>([^<]+)<\/h[12]>/i);
        if (h1Match) {
            const title = h1Match[1].trim();
            // Skip if it's the same as book title or empty
            if (title && normalizeTitle(title) !== bookTitleNormalized) {
                return title;
            }
        }

        // Try to find <h3> or <h4> headings
        const h3Match = html.match(/<h[34][^>]*>([^<]+)<\/h[34]>/i);
        if (h3Match) {
            const title = h3Match[1].trim();
            if (title && normalizeTitle(title) !== bookTitleNormalized) {
                return title;
            }
        }

        // Try to extract from first paragraph that might be a chapter heading
        // Look for patterns like "Chapter 1", "CHAPTER ONE", or just standalone numbers
        const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
        if (bodyMatch) {
            const bodyContent = bodyMatch[1];

            // Remove script/style tags
            const cleanBody = bodyContent
                .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

            // Find first <p> tag that might contain chapter heading
            const pMatch = cleanBody.match(/<p[^>]*>([^<]{1,100})<\/p>/i);
            if (pMatch) {
                const firstP = pMatch[1].trim();

                // Check if it looks like a chapter heading (short, possibly with number)
                if (firstP.length < 50 && firstP.length > 0) {
                    // Check for patterns like "Chapter 1", "Chương 1", "I", "II", etc.
                    const chapterPattern = /^(chapter|chương|chap|phần|phần)\s*\d+/i;
                    const romanPattern = /^(I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII|XIII|XIV|XV)$/;
                    const numberPattern = /^\d{1,3}$/;

                    if (chapterPattern.test(firstP) || romanPattern.test(firstP) || numberPattern.test(firstP)) {
                        return firstP;
                    }

                    // If it's not the book title and looks like a heading, use it
                    if (normalizeTitle(firstP) !== bookTitleNormalized) {
                        return firstP;
                    }
                }
            }
        }

        return null;
    }

    /**
     * Detect if chapter is Table of Contents
     */
    private detectTableOfContents(title: string): boolean {
        const lowerTitle = title.toLowerCase();
        const tocPatterns = [
            'mục lục',
            'table of contents',
            'contents',
            'muc luc',
            '目录',
            'toc'
        ];

        return tocPatterns.some(pattern => lowerTitle.includes(pattern));
    }

    /**
     * Process a single chapter: extract text and segment
     */
    private async processChapter(
        bookId: number,
        chapterTitle: string,
        html: string,
        chapterIndex: number,
        isTableOfContents: boolean = false
    ): Promise<void> {
        // Remove HTML tags to get plain text (simple regex approach)
        let text = html
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        // Clean metadata patterns - MUST happen before creating segments
        text = this.cleanMetadata(text);

        // Remove redundant chapter title at the beginning
        const normalizedTitle = chapterTitle.trim().toLowerCase();
        const lowerText = text.toLowerCase();

        if (lowerText.startsWith(normalizedTitle)) {
            // Remove the title prefix + any following punctuation or space
            text = text.substring(chapterTitle.length).replace(/^[\s.:\-\u2013\u2014]+/, '').trim();
            console.log(`[Chapter ${chapterIndex}] Removed redundant title prefix: "${chapterTitle}"`);
        }

        console.log(`[Chapter ${chapterIndex}] After cleaning, text starts with:`, text.substring(0, 150));

        // Create chapter
        const chapter = await prisma.chapter.create({
            data: {
                title: chapterTitle,
                bookId,
                orderIndex: chapterIndex,
                isTableOfContents,
            },
        });

        // Segment text into sentences
        const segmentTexts = this.splitIntoSentences(text);

        console.log(`[Chapter ${chapterIndex}] Saving ${segmentTexts.length} segments...`);

        // Save segments to database in bulk with default 'narrator' role
        if (segmentTexts.length > 0) {
            const segmentData = segmentTexts.map((content, i) => ({
                content,
                role: 'narrator' as const,
                chapterId: chapter.id,
                orderIndex: i,
            }));

            await prisma.textSegment.createMany({
                data: segmentData,
            });
        }
    }

    /**
     * Clean metadata patterns from extracted text
     * FIXED: Detects title repetition even with author name in between
     */
    private cleanMetadata(text: string): string {
        const words = text.split(/\s+/);

        // Try to find title repetition in the first 20 words
        // Pattern: "TITLE [other words] TITLE" (author name may be in between)
        for (let titleLen = 2; titleLen <= 5; titleLen++) {
            const potentialTitle = words.slice(0, titleLen).join(' ').toLowerCase();

            // Search for this title appearing again in next 15 words
            for (let searchPos = titleLen; searchPos <= Math.min(20, words.length - titleLen); searchPos++) {
                const candidate = words.slice(searchPos, searchPos + titleLen).join(' ').toLowerCase();

                if (potentialTitle === candidate && potentialTitle.length > 8) {
                    // Found duplicate! Remove everything before the SECOND occurrence
                    text = words.slice(searchPos).join(' ');
                    console.log(`[cleanMetadata] Removed duplicate title: "${potentialTitle}" at position 0 and ${searchPos}`);
                    return text.trim();
                }
            }
        }

        return text.trim();
    }

    /**
     * Split text into sentences
     */
    private splitIntoSentences(text: string): string[] {
        // Split by sentence-ending punctuation, handles some edge cases
        const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
        return sentences.map(s => s.trim()).filter(s => s.length > 0);
    }
}
