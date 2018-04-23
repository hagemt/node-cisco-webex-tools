/* eslint-env node */
const inquirer = require('inquirer')
const _ = require('lodash')

const log = require('../support/log.js')

const ClientTools = require('../support/ClientTools.js')

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
const findUniquePerson = async (clientTools, ...allStrings) => {
	const isEmailAddress = anyString => anyString.includes('@')
	const uniqueStrings = Array.from(new Set(allStrings.map(toString)))
	const [emails, others] = _.partition(uniqueStrings, isEmailAddress)
	for (const other of others) {
		const person = await clientTools.getPersonDetails(other).catch(() => null)
		if (person) return person // assumes other is id:String, ignores error(s)
	}
	for (const email of emails) {
		const people = await clientTools.listPeople({ email }).catch(() => [])
		if (people.length === 1) return people[0] // don't allow multiples
	}
	throw new Error(`no such person: ${uniqueStrings.join()}`)
}

// returns an Array of developer feature toggle Objects
// feature toggle will be set if key AND value are defined
const findDeveloperFeatures = async (tools, key, value) => {
	await tools.pingFeatureService() // ensures correct URL
	if (!key) {
		const all = await tools.listDeveloperFeatures([])
		return all
	}
	if (!value) {
		try {
			const [one] = await tools.listDeveloperFeatures([key])
			return [one]
		} catch (error) {
			if (!error.message.includes('Not Found')) throw error
			return [{ key, val: 'Not Found (should set value)' }]
		}
	}
	return [await tools.setDeveloperFeature(key, value)]
}

// inquire (once) for any token not for 'me'
const buildClientMap = async (tools, all) => {
	const me = await tools.getPersonDetails('me')
	const people = _.uniqBy(await Promise.all(Array.from(all, one => findUniquePerson(tools, one))), 'id')
	const questions = Array.from(people)
		.filter(({ id }) => id !== me.id)
		.map(person => Object.freeze({
			message: `What is the access token for the "${person.displayName}" user?`,
			name: `askAccessToken:${person.id}`,
			person,
		}))
	const answers = await inquirer.prompt(questions)
	return new Map(people.map((person) => {
		const token = answers[`askAccessToken:${person.id}`]
		return [person, token ? ClientTools.fromAccessToken(token) : tools]
	}))
}

// all this logic really needs refactoring; ideas for v1.0:
// accept a JSON (or similar) file listing features and users
// put this behind a flag we could call -b, --bulk $filepath
const buildResultMap = async (token, users, key, value) => {
	const results = new Map()
	const who = await buildClientMap(ClientTools.fromAccessToken(token), users.split(','))
	for (const [person, client] of who) {
		/*
		// for v1.0, could prompt with a menu of available toggles, then set interactively?
		const query = `${key || ''}=${value || ''}` // need to support -b, --bulk $YAML?
		log.debug('for %s (%s) will toggle: %s', person.id, person.displayName, query)
		const what = new Map(Object.entries(require('querystring').parse(query)))
		const array = []
		for (const [key, value] of what) {
			const all = await findDeveloperFeatures(client, key, value)
			for (const one of all) array.push(one)
		}
		results.push([person, array])
		*/
		results.set(person, await findDeveloperFeatures(client, key, value))
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
			for (const [key, value] of result) {
				console.error(`=== developer features for ${key.displayName} ===`)
				value.sort(({ key: k1 }, { key: k2 }) => compareStrings(k1, k2))
				if (process.stdout.isTTY) console.log(tableKVs(...value))
				else console.log(JSON.stringify(value, null, '\t'))
			}
		})
		.catch((reason) => {
			console.error(reason)
			process.exitCode = 1
		})
}
