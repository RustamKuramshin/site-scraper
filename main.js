#!/usr/bin/env node

const argv = require('yargs').argv;
const puppeteer = require('puppeteer');
const SimpleNodeLogger = require('simple-node-logger');
const fse = require('fs-extra');
const csvWriter = require('csv-writer').createObjectCsvWriter({
    path: argv.out,
    header: [
        {id: 'productDescription', title: 'Description'},
        {id: 'productImageUrl', title: 'ImageUrl'},
        {id: 'productPageUrl', title: 'PageUrl'},
        {id: 'categoryName', title: 'Category'},
        {id: 'productNumber', title: 'Number'},
        {id: 'productPrice', title: 'Price'}
    ]
});
const logFilePath = 'console.log';
fse.removeSync(logFilePath);
const opts = {
        logFilePath:logFilePath,
        timestampFormat:'YYYY-MM-DD HH:mm:ss.SSS'
};
const log = SimpleNodeLogger.createSimpleLogger( opts );


const processProductsPage = async (page, categoryInfo) => {
    try {
        await page.goto(categoryInfo.categoryUrl);
        await page.content();

        const articleSelector = 'article';
        await page.waitForSelector(articleSelector, {visible: true});
        const articles = await page.$$eval(articleSelector, articleArray => articleArray.map(article => ({
            productId: article.id,
            productDescription: article.firstChild.getAttribute('aria-label'),
            productPageUrl: article.firstChild.href
        })));
        const imgSelector = '.img';
        for (let article of articles) {
            await page.goto(article.productPageUrl);
            await page.content();
            await page.waitForSelector(imgSelector, {visible: true});
            const images = await page.$$eval(imgSelector, imgArray => imgArray.map(img => ({productImageUrl: img.src})));
            const prices = await page.$$eval('.current-price', pricesArray => pricesArray.map(price => ({productPrice: price.innerText})));
            const record = [{
                productDescription: article.productDescription,
                productImageUrl: images[1].productImageUrl,
                productPageUrl: article.productPageUrl,
                categoryName: categoryInfo.categoryName,
                productNumber: article.productId.replace('product-', ''),
                productPrice: prices[0].productPrice
            }];
            log.info(record);
            await csvWriter.writeRecords(record);
        }
        await page.goto(categoryInfo.categoryUrl);
    } catch (e) {
        log.error(e);
    }
};

(async () => {
    log.info('Start scraping');
    try {
        const browser = await puppeteer.launch({
            headless: (argv.headless === 'true'),
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/78.0.3904.70 Safari/537.36');
        await page.setViewport({
            width: 1920,
            height: 1080,
            deviceScaleFactor: 1,
        });
        await page.goto(argv.url);
        const linksSelector = 'a:first-child';
        await page.waitForSelector(linksSelector, {visible: true});
        const links = await page.$$eval(linksSelector, linksArray => linksArray.map(link => ({
            categoryUrl: link.href,
            categoryName: link.innerText
        })));
        const re = /.*\|.*/;

        const loadMoreProductsSelector = '[data-auto-id="loadMoreProducts"]';
        for (let link of links.filter(item => item.categoryUrl.match(re))) {
            if (link.categoryName === 'View all') {
                continue;
            }
            await processProductsPage(page, link);
            while (true) {
                try {
                    await page.waitForSelector(loadMoreProductsSelector, {visible: true});
                    const lmps = await page.$$eval(loadMoreProductsSelector, lmpArray => lmpArray.map(lmp => ({url: lmp.href})));
                    await processProductsPage(page, lmps[0].url);
                } catch (e) {
                    log.error(e);
                    break;
                }
            }
        }
        await browser.close();
    } catch (e) {
        log.error(e);
    }
    log.info('Stop scraping');
})();