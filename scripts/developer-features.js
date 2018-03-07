/* eslint-env node */
const _ = require('lodash')

const log = require('../support/log.js')

const SparkTools = require('../support/SparkTools.js')

const toString = (any = '') => String(!any || any === 'undefined' ? '' : any)
const compareStrings = (one, two) => toString(one).localeCompare(toString(two))
const padString = (any, pad, len) => toString(any).padEnd(len, pad) // or, padStart

const tableKVs = (...all) => { // all feature toggles, each has key:String, val:String
	const longestK = all.reduce((longK, { key: k }) => Math.max(longK, toString(k).length), 'key'.length)
	const longestV = all.reduce((longV, { val: v }) => Math.max(longV, toString(v).length), 'value'.length)
	const rows = [] // header row and spacers:
	rows.push(`/-${padString('---', '-', longestK)}---${padString('-----', '-', longestV)}-\\`)
	rows.push(`| ${padString('key', ' ', longestK)} | ${padString('value', ' ', longestV)} |`)
	rows.push(`|-${padString('---', '-', longestK)}-|-${padString('-----', '-', longestV)}-|`)
	for (const { key: k, val: v } of all) {
		rows.push(`| ${padString(k, ' ', longestK)} | ${padString(v, ' ', longestV)} |`)
	}
	rows.push(`\\-${padString('---', '-', longestK)}---${padString('-----', '-', longestV)}-/`)
	return rows.join('\n')
}

const getUniquePerson = async (sparkTools, ...allStrings) => {
	const isEmailAddress = anyString => anyString.includes('@')
	const uniqueStrings = _.uniq(Array.from(allStrings, toString))
	if (uniqueStrings.length === 0) return sparkTools.getPersonDetails()
	const [emails, others] = _.partition(uniqueStrings, isEmailAddress)
	for (const other of others) {
		const person = await sparkTools.getPersonDetails(other).catch(() => null)
		if (person) return person // assumes other is id:String, ignores error(s)
	}
	for (const email of emails) {
		const people = await sparkTools.listPeople({ email }).catch(() => [])
		if (people.length === 1) return people[0] // don't allow multiples
	}
	throw new Error(`no such person: ${uniqueStrings.join()}`)
}

const askFeatureService = async (token, user, key, value) => {
	const spark = SparkTools.fromAccessToken(token) // or from env
	await spark.pingFeatureService() // to sanity check the token
	const id = _.get(await getUniquePerson(spark, user), 'id')
	if (!key) return spark.listDeveloperFeatures([], id)
	if (!value) return spark.listDeveloperFeatures([key], id)
	return [await spark.setDeveloperFeature(key, value, true, id)]
}

module.exports = {
	askFeatureService,
}

if (!module.parent) {
	/* eslint-disable no-console */
	const args = process.argv.slice(2).map(toString) // [user,key,value] String(s)
	if (args.length < 2) log.debug('for %s, will list all toggles', args[0] || 'you')
	if (args.length === 2) log.debug('for %s, will get toggle named %s', args[0], args[1])
	if (args.length > 2) log.debug('for %s, will set toggle %s=%s', args[0], args[1], args[2])
	askFeatureService(process.env.CISCOSPARK_ACCESS_TOKEN, ...args)
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
