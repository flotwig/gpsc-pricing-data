/* eslint-disable @typescript-eslint/no-unused-vars */
import yargs from 'yargs/yargs'
import { hideBin } from 'yargs/helpers'
import { JSDOM } from 'jsdom'
import fs from 'fs/promises'
import path from 'path'

const argv = yargs(hideBin(process.argv)).options({
    year: { type: 'number', demandOption: true, describe: 'Four-digit year.' },
    month: { type: 'number', demandOption: true, describe: 'Ordinal month beginning at 1 for January.' },
    warnOnError: { type: 'boolean', describe: 'Don\'t exit on non-fatal errors.' }
}).parseSync()

function warnOrFail(err: Error) {
    if (!argv.warnOnError) {
        throw err
    }

    console.warn('Non-fatal error encountered, continuing because `--warnOnError` was passed.')
    console.warn('Double-check output for consistency. Error:')
    console.warn(err)
    console.warn()
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function log(...args: any[]) {
    console.warn(...args)
}

function isArchived(year: number) {
    return year < 2019
}

function getMonthName(month: number) {
    const monthName = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][month - 1]
    if (!monthName) throw new Error(`Invalid month ordinal: ${month}`)
    return monthName
}

async function getDom(url: string) {
    const res = await fetch(url)
    const html = await res.text()
    return new JSDOM(html).window.document
}

async function getArchivedChartHtmlUrl(month: number, year: number): Promise<string> {
    throw new Error('Archived charts are currently broken on GPSC\'s side.')
}

function xpath(document: Document, xpath: string) {
    return document.evaluate(xpath, document, null, 7 /** XPathResult.ORDERED_NODE_SNAPSHOT_TYPE */, null)
}

function relativeUrl(from: string, to: string) {
    return new URL(to, from).toString()
}

async function getChartHtmlUrl(month: number, year: number) {
    if (isArchived(year)) {
        return getArchivedChartHtmlUrl(month, year)
    }

    const indexUrl = 'https://psc.ga.gov/utilities/natural-gas/marketers-pricing-index/'
    const indexDoc = await getDom(indexUrl)
    const innerText = `${getMonthName(month)} ${year}`

    log('Searching pricing index for', innerText, 'URL.')
    const anchors = xpath(indexDoc, `//a[text()="${innerText}"]`)

    if (anchors.snapshotLength !== 1) {
        warnOrFail(new Error('Unexpected number of anchors: ' + anchors.snapshotLength))
    }

    const url = relativeUrl(indexUrl, (anchors.snapshotItem(0) as HTMLAnchorElement).href)
    log('Found URL for', innerText, ':', url)
    return url
}

async function getChartPdfUrls(chartHtmlUrl: string) {
    const chartDoc = await getDom(chartHtmlUrl)

    function getUrlForHeading(heading: string, failOk?: boolean) {
        const anchors = xpath(chartDoc, `//h5[text()="${heading}"]//following::a`)
        if (anchors.snapshotLength === 0) {
            if (failOk) {
                return null
            }
            throw new Error('No anchors found for ' + heading + ': ' + anchors.snapshotLength)
        }
        return relativeUrl(chartHtmlUrl, (anchors.snapshotItem(0) as HTMLAnchorElement).href)
    }

    const urls = {
        senior: getUrlForHeading('Senior Citizens Rate Plans:'),
        variable: getUrlForHeading('Variable Rate Plans:'),
        fixed: getUrlForHeading('Fixed Rate Plans:'),
        // TODO: So far, only missing in 2021-01. Double-check once archive is available
        prepay: getUrlForHeading('Pre-Pay Plans:', true)
    }

    log('Found chart PDF URLs:', urls)

    return urls
}

async function downloadPdfs(month: number, year: number, chartPdfUrls: Record<string, string | null>) {
    log('Downloading chart PDFs.')

    await Promise.all(Object.entries(chartPdfUrls).map(async ([type, url]) => {
        if (!url) {
            return log('Skipping', type, 'since no URL was found.')
        }
        const filename = path.join(__dirname, '..', 'data', 'charts', type, `${year}-${String(month).padStart(2, '0')}.pdf`)
        const buffer = Buffer.from(await (await fetch(url)).arrayBuffer())
        await fs.writeFile(filename, buffer)
        log('Downloaded', type, 'to', filename, `(${buffer.byteLength} bytes)`)
    }))
}

(async () => {
    const chartHtmlUrl = await getChartHtmlUrl(argv.month, argv.year)
    const chartPdfUrls = await getChartPdfUrls(chartHtmlUrl)
    await downloadPdfs(argv.month, argv.year, chartPdfUrls)
})()