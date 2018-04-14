/* eslint-env node */
const inquirer = require('inquirer')
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

// returns the first person uniquely identified by a list of specifiers
// valid specifier: firstly, an id/UUID or email address (may be unique)
const findUniquePerson = async (sparkTools, ...allStrings) => {
	const isEmailAddress = anyString => anyString.includes('@')
	const uniqueStrings = Array.from(new Set(allStrings.map(toString)))
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

// returns an Array of developer feature toggle Objects
// feature toggle will be set if key AND value are defined
const listDeveloperFeatures = async (spark, key, value) => {
	await spark.pingFeatureService()
	const me = await spark.getPersonDetails('me')
	if (!key) return spark.listDeveloperFeatures([], me)
	if (!value) return spark.listDeveloperFeatures([key], me)
	return [await spark.setDeveloperFeature(key, value, true, me)]
}

const buildClientMap = async (spark, all) => {
	const me = await spark.getPersonDetails('me')
	const people = _.uniqBy(await Promise.all(Array.from(all, one => findUniquePerson(spark, one))), 'id')
	const questions = Array.from(people)
		.filter(({ id }) => id !== me.id)
		.map(person => Object.freeze({
			message: `What is the access token for the "${person.displayName}" user?`,
			name: `askAccessToken:${person.id}`,
			person,
		}))
	const answers = await inquirer.prompt(questions).catch(() => null)
	if (!answers) throw new Error('Sorry, but I need access tokens to do that.')
	return new Map(people.map((person) => {
		const token = answers[`askAccessToken:${person.id}`]
		return [person, token ? SparkTools.fromAccessToken(token) : spark]
	}))
}

const buildResultMap = async (token, users, key, value) => {
	const results = new Map()
	const who = await buildClientMap(SparkTools.fromAccessToken(token), users.split(','))
	for (const [person, client] of who) {
		/*
		// for v1.0, could prompt with a menu of available toggles, then set interactively?
		const query = `${key || ''}=${value || ''}` // need to support -b, --bulk $YAML?
		log.debug('for %s (%s) will toggle: %s', person.id, person.displayName, query)
		const what = new Map(Object.entries(require('querystring').parse(query)))
		const array = []
		for (const [key, value] of what) {
			const all = await listDeveloperFeatures(client, key, value)
			for (const one of all) array.push(one)
		}
		results.push([person, array])
		*/
		results.set(person, await listDeveloperFeatures(client, key, value))
	}
	return results
}

if (!module.parent) {
	/* eslint-disable no-console */
	const args = process.argv.slice(2).map(toString) // [users,key,value] String(s)
	if (args.length < 2) log.debug('for %s, will list all toggles', args[0] || 'me')
	if (args.length === 2) log.debug('for %s, will get toggle named %s', args[0], args[1])
	if (args.length > 2) log.debug('for %s, will set toggle %s=%s', args[0], args[1], args[2])
	buildResultMap(process.env.CISCOSPARK_ACCESS_TOKEN, ...args)
		.then((result) => {
			for (const toggles of result.values()) {
				//console.error(`=== developer features for ${key.displayName} ===`)
				toggles.sort(({ key: k1 }, { key: k2 }) => compareStrings(k1, k2))
				if (process.stdout.isTTY) console.log(tableKVs(...toggles))
				else console.log(JSON.stringify(toggles, null, '\t'))
			}
		})
		.catch((reason) => {
			console.error(reason)
			process.exitCode = 1
		})
}
