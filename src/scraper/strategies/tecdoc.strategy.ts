import { Injectable, Logger } from '@nestjs/common';
import { Page } from 'puppeteer';
import { IScraperStrategy } from '../interfaces/scraper-strategy.interface';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class TecDocStrategy implements IScraperStrategy {
    name = 'tecdoc';
    private readonly logger = new Logger(TecDocStrategy.name);
    private readonly cookiesPath = path.resolve(process.cwd(), 'tecdoc_cookies.json');

    constructor(private configService: ConfigService) { }

    private async handleCookieConsent(page: Page): Promise<void> {
        this.logger.log('Checking for cookie consent...');
        try {
            // Check for the "Set your consent" link/button
            const openPopup = await page.$('#ppms_cm_open-popup');
            if (openPopup) {
                this.logger.log('Cookie banner found. Opening popup...');
                await openPopup.click();
                try {
                    await page.waitForSelector('#ppms_cm_popup_content', { timeout: 5000 });

                    // Look for "Agree to all" or similar
                    const agreeBtn = await page.evaluateHandle(() => {
                        const buttons = Array.from(document.querySelectorAll('button, a'));
                        // Multi-language support guess
                        return buttons.find(b => {
                            const t = b.textContent?.toLowerCase() || '';
                            return t.includes('agree') || t.includes('accept') || t.includes('consent') || t.includes('alles') || t.includes('aceitar');
                        });
                    });

                    const elementHandle = agreeBtn.asElement();
                    if (elementHandle) {
                        await elementHandle.evaluate((el: any) => el.click());
                        this.logger.log('Cookie consent accepted.');
                        await new Promise(r => setTimeout(r, 2000));
                    }
                } catch (e) {
                    this.logger.warn(`Popup opened but accept button not found: ${e.message}`);
                }
            } else {
                // Check if the "Agree to all" button is directly visible (sometimes happens)
                const directAgree = await page.$('#ppms_cm_agree-to-all');
                if (directAgree) {
                    await directAgree.click();
                    this.logger.log('Direct cookie consent accepted.');
                    await new Promise(r => setTimeout(r, 2000));
                }
            }
        } catch (e) {
            this.logger.warn(`Cookie consent handling failed/skipped: ${e}`);
        }
    }

    async login(page: Page): Promise<void> {
        const loginUrl = this.configService.get<string>('TECDOC_LOGIN_URL');

        const username = this.configService.get<string>('TECDOC_USERNAME');
        const password = this.configService.get<string>('TECDOC_PASSWORD');

        if (!loginUrl || !username || !password) {
            this.logger.warn('TecDoc credentials not set. Skipping login check.');
            return;
        }

        // 1. Try to load cookies
        if (fs.existsSync(this.cookiesPath)) {
            try {
                const cookiesString = fs.readFileSync(this.cookiesPath, 'utf8');
                const cookies = JSON.parse(cookiesString);
                await page.setCookie(...cookies);
                this.logger.log(`Loaded ${cookies.length} cookies from session file.`);
            } catch (e) {
                this.logger.warn(`Failed to load cookies: ${e.message}`);
                // Corrupt file? Delete it
                try { fs.unlinkSync(this.cookiesPath); } catch (e2) { }
            }
        }

        try {
            this.logger.log('Navigating to login page to check session...');
            await page.goto(loginUrl, { waitUntil: 'networkidle2' });

            // Robust check: Wait for EITHER the logout button (logged in) OR the login input (logged out)
            const logoutSelector = '#logout';
            const emailSelector = 'input[formcontrolname="userName"]';

            try {
                this.logger.log('Waiting for session status...');
                await page.waitForFunction(
                    (logout, email) => document.querySelector(logout) || document.querySelector(email),
                    { timeout: 10000 },
                    logoutSelector,
                    emailSelector
                );
            } catch (e) {
                this.logger.warn('Timeout waiting for session status. Assuming login needed or page error.');
            }

            const isLoggedIn = (await page.$(logoutSelector)) !== null;

            if (isLoggedIn) {
                this.logger.log('Already logged in (Session restored).');
                return;
            }

            this.logger.log('Session not valid or not logged in. Proceeding to login...');

            // 2. Handle Consent Popup (if exists)
            try {
                const consentButtonSelector = '#ppms_cm_agree-to-all';
                if (await page.$(consentButtonSelector)) {
                    await page.click(consentButtonSelector);
                    this.logger.log('Consent popup closed.');
                    await new Promise(r => setTimeout(r, 1000));
                }
            } catch (e) {
                // Ignore
            }

            // 3. Login
            const passwordSelector = 'input[formcontrolname="password"]';
            const submitSelector = 'button[tabuttonprimary]';

            await page.waitForSelector(emailSelector, { visible: true, timeout: 5000 });
            this.logger.log('Login form detected. Logging in...');

            // Clear inputs first just in case
            await page.evaluate((sel) => { if (document.querySelector(sel)) (document.querySelector(sel) as HTMLInputElement).value = ''; }, emailSelector);
            await page.type(emailSelector, username);

            await page.evaluate((sel) => { if (document.querySelector(sel)) (document.querySelector(sel) as HTMLInputElement).value = ''; }, passwordSelector);
            await page.type(passwordSelector, password);

            await Promise.all([
                page.waitForNavigation({ waitUntil: 'networkidle2' }),
                page.click(submitSelector),
            ]);
            this.logger.log('Login submitted.');

            // Wait for logout button to confirm success
            try {
                await page.waitForSelector('#logout', { timeout: 10000 });
                this.logger.log('Login confirmed (Logout button visible).');

                // Save cookies after successful login
                const cookies = await page.cookies();
                fs.writeFileSync(this.cookiesPath, JSON.stringify(cookies, null, 2));
                this.logger.log('Session cookies saved.');
            } catch (e) {
                this.logger.warn('Login submitted but logout button not found yet. Proceeding tailored to risk.');
            }

        } catch (error) {
            this.logger.error(`Login failed: ${error.message}`);
            // If login failed, maybe delete cookies to force fresh start next time
            if (fs.existsSync(this.cookiesPath)) {
                fs.unlinkSync(this.cookiesPath);
                this.logger.log('Deleted invalid session cookies.');
            }
        }
    }

    async scrape(page: Page, url: string, onProgress?: (items: any[]) => Promise<void>): Promise<any[]> {
        this.logger.log(`Starting scrape from: ${url}`);
        await page.setViewport({ width: 1920, height: 1080 });

        // Parse URL params
        let currentPage = 1;
        const urlObj = new URL(url);

        // Extract start page if present
        const queryPage = urlObj.searchParams.get('page');
        if (queryPage) currentPage = parseInt(queryPage, 10);

        // Helper to construct URL for a specific page using string manipulation to preserve hash weirdness
        const getUrlForPage = (p: number, originalUrl: string) => {
            let newUrl = originalUrl;
            // Update Query Param
            if (newUrl.includes('page=')) {
                newUrl = newUrl.replace(/page=\d+/, `page=${p}`);
            } else {
                if (newUrl.includes('?')) newUrl += `&page=${p}`;
                else newUrl += `?page=${p}`;
            }
            // Update Hash Param (TecDoc uses ;page:1 style in hash)
            if (newUrl.includes('page:')) {
                newUrl = newUrl.replace(/page:\d+/, `page:${p}`);
            } else {
                // Try to append to hash if it looks like the specific format
                if (newUrl.includes('#') && !newUrl.includes('page:')) {
                    newUrl += `;page:${p}`;
                }
            }
            return newUrl;
        };

        const allResults: any[] = [];
        let hasNextPage = true;

        while (hasNextPage) {
            const currentUrl = getUrlForPage(currentPage, url);
            this.logger.log(`Navigating to Page ${currentPage}: ${currentUrl}`);

            try {
                await page.goto(currentUrl, { waitUntil: 'networkidle2' });
            } catch (e) {
                this.logger.warn(`Navigation failed: ${e.message}. Retrying...`);
                await page.reload({ waitUntil: 'networkidle2' });
                await new Promise(r => setTimeout(r, 4000)); // Added extra wait after reload
            }

            // Check grid presence
            try {
                this.logger.log('Waiting for grid rows...');
                // Wait for the loading overlay to disappear if it exists
                try {
                    await page.waitForSelector('.ag-overlay-loading-wrapper', { hidden: true, timeout: 5000 });
                } catch (e) { }

                // Wait for actual rows
                await page.waitForSelector('.ag-center-cols-container .ag-row', { timeout: 15000 });

                // Extra wait to ensure all rows render (virtual scrolling sometimes loads incrementally)
                await new Promise(r => setTimeout(r, 3000));
            } catch (e) {
                this.logger.warn('Grid rows not found. Checking session or End of Results.');
                // Check if session invalid
                const loginForm = await page.$('input[formcontrolname="userName"]');
                if (loginForm) {
                    this.logger.warn('Session expired. Relogging...');
                    await this.login(page); // Attempt Relogin
                    await page.goto(currentUrl, { waitUntil: 'networkidle2' });
                    try { await page.waitForSelector('.ag-center-cols-container .ag-row', { timeout: 15000 }); }
                    catch (e2) {
                        this.logger.warn('Still no data after relogin. Assuming last page reached.');
                        break;
                    }
                } else {
                    // Likely end of pagination (empty page)
                    this.logger.log('No rows found. Assuming end of pagination.');
                    break;
                }
            }

            await this.handleCookieConsent(page);

            // Re-select rows on each page iteration
            let rows = await page.$$('.ag-center-cols-container .ag-row');

            // Heuristic: If we only see 1 row, it might be a header or error, wait a bit longer
            if (rows.length === 1) {
                this.logger.log('Only 1 row found. Waiting a bit longer...');
                await new Promise(r => setTimeout(r, 3000));
                rows = await page.$$('.ag-center-cols-container .ag-row');
            }

            if (rows.length === 0) {
                this.logger.log('No rows found on this page. Stopping.');
                break;
            }

            this.logger.log(`Found ${rows.length} rows on page ${currentPage}.`);
            const pageResults: any[] = [];

            for (let i = 0; i < rows.length; i++) {
                // Re-query rows to avoid stale references
                rows = await page.$$('.ag-center-cols-container .ag-row');
                const currentRow = rows[i];
                if (!currentRow) continue;

                // Check if row is a valid product row (sometimes ag-grid has filler rows)
                const isGroupRow = await currentRow.evaluate(el => el.classList.contains('ag-row-group'));
                if (isGroupRow) continue;

                let gridProductName = '';
                try {
                    gridProductName = await currentRow.$eval('div[col-id="description"] .generic-article', el => el.textContent?.trim() || '');
                } catch (e) { }

                this.logger.log(`Processing row ${i + 1}/${rows.length}: ${gridProductName}`);

                try {
                    // Click the row to open details
                    await currentRow.click();

                    // Extract details using the helper
                    const { extractedData, viewOpened } = await this.extractDetail(page, gridProductName);
                    if (extractedData && extractedData.length > 0) {
                        pageResults.push(...extractedData);
                        allResults.push(...extractedData);
                    }

                    // Go Back DO NOT GO BACK if view didn't open
                    if (viewOpened) {
                        this.logger.log('Navigating back to list...');
                        const backBtn = await page.$('a.p-menuitem-link:has(span.ta-icon-back)');
                        if (backBtn) {
                            await backBtn.click();
                        } else {
                            await page.click('.ta-icon-back').catch(() => { });
                        }

                        // Wait for grid to reappear
                        await page.waitForSelector('.ag-center-cols-container .ag-row', { timeout: 10000 });
                        await new Promise(r => setTimeout(r, 1000)); // Settlement
                    } else {
                        this.logger.warn('View did not open, skipping Back navigation and proceeding to next row (if possible).');
                        const onList = await page.$('.ag-center-cols-container');
                        if (!onList) await page.goBack().catch(() => { });
                    }

                } catch (e) {
                    this.logger.warn(`Failed to process row ${i}: ${e.message}`);
                    const onList = await page.$('.ag-center-cols-container');
                    if (!onList) await page.goBack().catch(() => { });
                }
            } // End of Row Loop

            // Incremental Save
            if (pageResults.length > 0 && onProgress) {
                this.logger.log(`Saving ${pageResults.length} items from page ${currentPage}...`);
                await onProgress(pageResults);
            }

            // Move to next page
            currentPage++;
        }

        return allResults;
    }

    private async extractDetail(page: Page, gridProductName: string): Promise<{ extractedData: any[], viewOpened: boolean }> {
        this.logger.log('Waiting for detail view...');

        // Wait for detail view logic
        try {
            await page.waitForFunction(() => {
                const overlay = document.querySelector('.mb-overlay-panel');
                if (overlay) {
                    const style = window.getComputedStyle(overlay);
                    if (style.visibility === 'visible' && style.opacity !== '0' && overlay.getBoundingClientRect().width > 10) return true;
                }
                const detailComponent = document.querySelector('part-detail-v2');
                if (detailComponent && detailComponent.getBoundingClientRect().width > 10) return true;
                return false;
            }, { timeout: 15000 });
        } catch (e) {
            this.logger.warn('Detail view did not appear.');
            return { extractedData: [], viewOpened: false };
        }

        // Initialize collections
        let applicationSummary: string[] = [];
        let oemCodes: string[] = [];

        // Give a moment for data to settle
        await new Promise(r => setTimeout(r, 2000));

        // 1. Vehicles (Deep Extraction)
        try {
            const vehicleTabSelector = 'a[role="tab"] i.ta-icon-car';
            const tabElement = await page.$(vehicleTabSelector);

            if (tabElement) {
                this.logger.log('Clicking Linked Vehicles tab...');
                await tabElement.click();
                await new Promise(r => setTimeout(r, 2000));

                const manufacturerLinkSelector = 'a[ta-name="linkage-brand"]';
                try {
                    await page.waitForSelector(manufacturerLinkSelector, { timeout: 5000 });
                    const manufacturerLinks = await page.$$(manufacturerLinkSelector);
                    this.logger.log(`Found ${manufacturerLinks.length} manufacturer links.`);

                    for (let i = 0; i < manufacturerLinks.length; i++) {
                        const links = await page.$$(manufacturerLinkSelector);
                        if (!links[i]) continue;
                        const link = links[i];
                        const brandName = await link.evaluate(el => el.textContent?.trim() || 'Unknown');

                        // New Tab Listener
                        const newTargetPromise = new Promise<Page | null>(resolve => {
                            const listener = async (target: any) => {
                                if (target.opener() === page.target()) {
                                    page.browser().off('targetcreated', listener);
                                    resolve(await target.page());
                                }
                            };
                            page.browser().on('targetcreated', listener);
                            setTimeout(() => { page.browser().off('targetcreated', listener); resolve(null); }, 5000);
                        });

                        await link.click();
                        const newPage = await newTargetPromise;

                        if (newPage) {
                            try {
                                await newPage.setViewport({ width: 1920, height: 1080 });
                                try { await newPage.waitForNavigation({ waitUntil: 'networkidle2', timeout: 5000 }); } catch (e) { }
                                await newPage.waitForSelector('tr[ta-name="vehicle-linkage__item"]', { timeout: 10000 });

                                const vehicles = await newPage.evaluate((brand) => {
                                    const rows = Array.from(document.querySelectorAll('tr[ta-name="vehicle-linkage__item"]'));
                                    return rows.map(row => {
                                        const getColText = (index: number) => { const cols = row.querySelectorAll('th, td'); return cols[index]?.textContent?.trim() || ''; }
                                        const modelName = row.querySelector('a span.text-primary')?.textContent?.trim() || getColText(0);
                                        const year = getColText(2);
                                        const kw = getColText(4);
                                        const hp = getColText(5);
                                        const cc = getColText(6);
                                        const body = getColText(7);
                                        return `${modelName} (${year}) - ${kw}KW / ${hp}HP - ${cc}cc - ${body}`;
                                    });
                                }, brandName);
                                applicationSummary.push(...vehicles);
                            } catch (e) {
                                this.logger.warn(`Failed to scrape new tab for ${brandName}: ${e.message}`);
                            } finally {
                                await newPage.close();
                            }
                        } else {
                            // Modal Fallback
                            try {
                                const modalRowSelector = 'tr[ta-name="vehicle-linkage__item"]';
                                await page.waitForSelector(modalRowSelector, { timeout: 5000 });
                                const vehicles = await page.evaluate((brand) => {
                                    const rows = Array.from(document.querySelectorAll('tr[ta-name="vehicle-linkage__item"]'));
                                    return rows.map(row => {
                                        const getColText = (index: number) => { const cols = row.querySelectorAll('th, td'); return cols[index]?.textContent?.trim() || ''; }
                                        const modelName = row.querySelector('a span.text-primary')?.textContent?.trim() || getColText(0);
                                        const year = getColText(2);
                                        const kw = getColText(4);
                                        const hp = getColText(5);
                                        const cc = getColText(6);
                                        const body = getColText(7);
                                        return `${modelName} (${year}) - ${kw}KW / ${hp}HP - ${cc}cc - ${body}`;
                                    });
                                }, brandName);
                                applicationSummary.push(...vehicles);
                                await page.keyboard.press('Escape');
                                await new Promise(r => setTimeout(r, 1000));
                            } catch (e) { }
                        }
                    }
                } catch (e) { }
            }
        } catch (e) { }

        // 2. OE Codes (Dropdown)
        try {
            const oeTabSelector = 'a[role="tab"] i.ta-icon-manufactor';
            let oeTab = await page.$(oeTabSelector);
            if (!oeTab) {
                const tabs = await page.$$('a[role="tab"]');
                for (const t of tabs) {
                    const txt = await t.evaluate(el => el.textContent?.trim() || '');
                    if (txt.includes('OE') || txt.includes('Numer') || txt.includes('Ref')) { oeTab = t; break; }
                }
            }
            if (oeTab) {
                await oeTab.click();
                await new Promise(r => setTimeout(r, 2000));

                const oeRowSelector = 'tr[ta-name="oe-number"]';
                const dropdownButtonSelector = 'p-autocomplete button';
                const dropdownInputSelector = 'p-autocomplete input';

                // Check if dropdown exists and if it is enabled
                let hasDropdown = (await page.$(dropdownButtonSelector) || await page.$(dropdownInputSelector)) !== null;
                const isDropdownDisabled = await page.$eval('p-autocomplete', el => el.classList.contains('p-disabled') || el.classList.contains('p-component-disabled')).catch(() => false);

                // If it exists but is disabled, we treat it as a single view (no iteration)
                if (isDropdownDisabled) {
                    this.logger.log('OE Dropdown detected but disabled. Scraping visible table directly.');
                    hasDropdown = false;
                }

                const gatheredCodes = new Set<string>();

                if (hasDropdown) {
                    this.logger.log('OE Manufacturer dropdown detected. Iterating...');

                    // Click to open suggestions
                    const trigger = await page.$(dropdownButtonSelector) || await page.$(dropdownInputSelector);
                    if (trigger) {
                        await trigger.click();
                        await page.waitForSelector('ul.p-autocomplete-items, ul.p-autocomplete-list', { timeout: 3000 }).catch(() => { });
                    }

                    // Get list items count
                    const itemsSelector = 'ul.p-autocomplete-items li, ul.p-autocomplete-list li';
                    const itemsCount = await page.evaluate((sel) => document.querySelectorAll(sel).length, itemsSelector);

                    this.logger.log(`Found ${itemsCount} manufacturers in OE dropdown.`);

                    if (itemsCount > 0) {
                        for (let i = 0; i < itemsCount; i++) {
                            // Re-open dropdown if needed (it usually closes after selection)
                            try {
                                const trigger = await page.$(dropdownButtonSelector) || await page.$(dropdownInputSelector);
                                if (trigger) await trigger.click();
                                await page.waitForSelector(itemsSelector, { timeout: 2000 });
                            } catch (e) { }

                            // Click item by index
                            await page.evaluate((sel, index) => {
                                const items = document.querySelectorAll(sel);
                                if (items[index]) (items[index] as HTMLElement).click();
                            }, itemsSelector, i);

                            // Wait for table update
                            await new Promise(r => setTimeout(r, 1000));

                            // Scrape codes from current view
                            const codes = await page.evaluate((sel) => {
                                const rows = Array.from(document.querySelectorAll(sel));
                                return rows.map(r => {
                                    return r.getAttribute('ta-value') || r.querySelector('strong')?.textContent?.trim() || '';
                                }).filter(t => t.length > 0);
                            }, oeRowSelector);

                            codes.forEach(c => gatheredCodes.add(c));
                        }
                    } else {
                        // Fallback: If dropdown is empty or just one view, scrape what's visible
                        this.logger.log('Dropdown empty or single view. Scraping visible table.');
                        const codes = await page.evaluate((sel) => {
                            const rows = Array.from(document.querySelectorAll(sel));
                            return rows.map(r => r.getAttribute('ta-value') || r.querySelector('strong')?.textContent?.trim() || '').filter(t => t.length > 0);
                        }, oeRowSelector);
                        codes.forEach(c => gatheredCodes.add(c));
                    }

                } else {
                    this.logger.log('No active OE dropdown found. Scraping visible table directly.');
                    await page.waitForSelector(oeRowSelector, { timeout: 5000 }).catch(() => { });

                    let codes = await page.evaluate((sel) => {
                        const rows = Array.from(document.querySelectorAll(sel));
                        return rows.map(r => r.getAttribute('ta-value') || r.querySelector('strong')?.textContent?.trim() || '').filter(t => t.length > 0);
                    }, oeRowSelector);

                    // Fallback: If strict selector failed, try broader row search in the active tab
                    if (codes.length === 0) {
                        codes = await page.evaluate(() => {
                            const activePanel = document.querySelector('p-tabview p-tabpanel[aria-hidden="false"]') || document.querySelector('page-part-detail-oes');
                            if (!activePanel) return [];
                            const rows = Array.from(activePanel.querySelectorAll('table tr'));
                            // Filter for rows that look like codes (e.g. have numbers)
                            return rows.map(r => r.textContent?.trim() || '').filter(t => t.length > 3 && /\d/.test(t));
                        });
                    }

                    codes.forEach(c => gatheredCodes.add(c));
                }

                oemCodes.push(...Array.from(gatheredCodes));
                this.logger.log(`Extracted ${oemCodes.length} unique OE codes.`);
            }
        } catch (e) { }

        // 3. Article Information
        try {
            const infoClicked = await page.evaluate(() => {
                const spans = Array.from(document.querySelectorAll('span.p-menuitem-text'));
                const target = spans.find(s => s.textContent?.includes('Article information') || s.textContent?.includes('informações'));
                if (target) { (target as HTMLElement).click(); return true; }
                return false;
            });
            if (!infoClicked) {
                const infoTab = await page.$('a[role="tab"] i.ta-icon-article-info');
                if (infoTab) await infoTab.click();
            }
            await new Promise(r => setTimeout(r, 2000));
        } catch (e) { }

        // Final Extraction
        const details = await page.evaluate((vehicles, oes, gridProductName) => {
            const text = (sel: string, root: Element | Document = document) => root.querySelector(sel)?.textContent?.trim() || '';
            const parseWeight = (str: string): number | null => {
                if (!str) return null;
                const match = str.match(/([\d,\.]+)\s*kg/i) || str.match(/([\d,\.]+)\s*g/i);
                if (match) {
                    let val = parseFloat(match[1].replace(',', '.'));
                    if (str.toLowerCase().includes('g') && !str.toLowerCase().includes('kg')) val /= 1000;
                    return val;
                }
                return null;
            };

            let container: Element | null = document.querySelector('page-part-detail');
            let source = 'FullPage';
            const overlay = document.querySelector('.mb-overlay-panel');
            if (overlay && (!container || overlay.contains(container))) {
                source = 'Overlay';
                container = overlay.querySelector('page-part-detail') || overlay;
            }

            if (!container) return { error: 'NoContainerFound' };

            let headerText = text('part-detail-v2-header span.text-truncate', container) || text('.mb-overlay-panel-header', container) || text('h3', container);

            let name = gridProductName || text('.product-group-name', container);
            const parts = headerText.split('|').map(s => s.trim());
            let brand = parts.length > 0 ? parts[0].toUpperCase() : '';
            let partNumber = parts.length > 1 ? parts[1] : '';

            if (!name && parts.length > 2) name = parts[2];
            if (!name) name = headerText;

            const criteriaRows = Array.from(container.querySelectorAll('part-detail-v2-criteria-tab tr, .criteria-table tr, table tr'));
            let weight: number | null = null;
            const attributes: any[] = [];
            let ean = '';

            criteriaRows.forEach(row => {
                const th = row.querySelector('th')?.textContent?.trim() || '';
                const td = row.querySelector('td')?.textContent?.trim() || '';
                if (!th || !td) return;

                // Name
                if (/Product group/i.test(th)) name = td;

                // Weight
                if (/peso|weight/i.test(th)) weight = parseWeight(td);

                // EAN
                if (/GTIN|EAN/i.test(th)) {
                    // Clean: remove soft hyphens, zero-width spaces, non-breaking spaces
                    let rawVal = td;
                    let cleanVal = rawVal.replace(/[\u00ad\u200b\u200c\u200d\u00a0\s]/g, '').trim();
                    if (/^\d+$/.test(cleanVal)) {
                        ean = cleanVal;
                    }
                }

                attributes.push({ name: th, value: td });
            });

            if (!name) name = text('.generic-name', container) || headerText;

            // Fallback EAN
            if (!ean) {
                const content = container.textContent || '';
                const eanMatch = content.match(/(?:EAN|GTIN)\s*[:\.]?\s*(\d{8,14})/i);
                if (eanMatch) ean = eanMatch[1];
            }

            let images = Array.from(container.querySelectorAll('gallery-container img, .gallery img')).map((img: any) => img.src);
            if (images.length === 0) images = Array.from(container.querySelectorAll('img.image-center, .mb-overlay-panel-body img')).map((img: any) => img.src);

            return { partNumber, name, brand, description: attributes.map(a => `${a.name}: ${a.value}`).join('\n'), weight: weight || 0, ean, images, price: 0, oemCodes: oes, applicationSummary: vehicles };

        }, applicationSummary, oemCodes, gridProductName);

        if ((details as any).error) return { extractedData: [], viewOpened: true }; // View opened but failed to find container content

        // ... debug dumps ... (omitted for brevity, assume valid return path)
        const detailsData = details as any;
        if (!detailsData) {
            this.logger.warn('Detail view extraction failed.');
            return { extractedData: [], viewOpened: true };
        }

        this.logger.log(`Extracted (${detailsData.source}): ${detailsData.partNumber}`);
        this.logger.log(`Name (Group): ${detailsData.name}`);
        this.logger.log(`EAN (Barcode): ${detailsData.ean ? detailsData.ean : 'NOT FOUND'}`);
        this.logger.log(`OE Codes found: ${detailsData.oemCodes.length}`);
        this.logger.log(`Vehicles found: ${detailsData.applicationSummary.length}`);

        return {
            extractedData: [{
                partNumber: detailsData.partNumber,
                name: detailsData.name,
                brand: { name: detailsData.brand },
                weight: detailsData.weight,
                images: detailsData.images,
                description: detailsData.description,
                oemCodes: detailsData.oemCodes,
                ean: detailsData.ean,
                applicationSummary: detailsData.applicationSummary
            }],
            viewOpened: true
        };
    }
}
