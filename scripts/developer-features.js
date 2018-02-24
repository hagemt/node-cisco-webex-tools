/* eslint-env node */
const SparkTools = require('../support/SparkTools.js')

const askFeatureService = async (key, value) => {
	const spark = SparkTools.fromAccessToken() // via process.env
	await spark.pingFeatureService() // throws if service is down
	if (!key) return spark.listDeveloperFeatures() // all toggles
	if (!value) return spark.listDeveloperFeatures({ keys: [key] })
	return [await spark.setDeveloperFeature(key, value)]
}

module.exports = {
	askFeatureService,
}

const toString = (any = '') => String(any === 'undefined' ? '' : any).slice()
const padString = (any, pad, len) => toString(any).padEnd(len, pad) // start?
const compareStrings = (one, two) => toString(one).localeCompare(toString(two))

const tableKVs = (...args) => {
	const longestK = args.reduce((longK, { key: k }) => Math.max(longK, toString(k).length), 'key'.length)
	const longestV = args.reduce((longV, { val: v }) => Math.max(longV, toString(v).length), 'value'.length)
	const rows = [] // header row and spacer:
	rows.push(`/-${padString('---', '-', longestK)}---${padString('-----', '-', longestV)}-\\`)
	rows.push(`| ${padString('key', ' ', longestK)} | ${padString('value', ' ', longestV)} |`)
	rows.push(`|-${padString('---', '-', longestK)}-|-${padString('-----', '-', longestV)}-|`)
	for (const { key: k, val: v } of args) {
		rows.push(`| ${padString(k, ' ', longestK)} | ${padString(v, ' ', longestV)} |`)
	}
	rows.push(`\\-${padString('---', '-', longestK)}---${padString('-----', '-', longestV)}-/`)
	return rows.join('\n')
}

if (!module.parent) {
	/* eslint-disable no-console */
	const [key, value] = process.argv.slice(2)
	askFeatureService(toString(key), toString(value))
		.then((toggles) => {
			toggles.sort(({ key: k1 }, { key: k2 }) => compareStrings(k1, k2))
			if (process.stdout.isTTY) console.log(tableKVs(...toggles))
			else console.log(JSON.stringify(toggles, null, '\t'))
		})
		.catch((reason) => {
			console.error(reason)
			process.exitCode = 1
		})
}
