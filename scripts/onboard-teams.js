const fs = require('fs')
const os = require('os')
const path = require('path')

const _ = require('lodash')

const SparkTools = require('../source/SparkTools.js')

const onboardTeams = async (userAccessToken, teamRosterFiles, isDryRun) => {
	const script = SparkTools.fromAccessToken(userAccessToken)
	const onboardTeam = async ({ name }, ...personEmails) => {
		const team = await script.createTeamWithMyself({ name })
		for (const personEmail of personEmails) {
			await script.addPersonToTeam(personEmail, team.id)
		}
		return team
	}
	const teams = new Map() // from teamname:String => personEmails:Set<String>
	for (const [teamname, filename] of Object.entries(teamRosterFiles)) {
		const setupErrors = []
		try {
			if (teams.has(teamname)) throw new Error(`duplicate team (name: ${teamname})`)
			const personEmails = fs.readFileSync(filename).toString().split(/\s+/)
			teams.set(teamname, new Set(personEmails.filter(notFalsey => !!notFalsey)))
		} catch (setupError) {
			setupErrors.push(setupError)
		}
		if (setupErrors.length > 0) {
			const messages = Array.from(setupErrors, setupError => setupError.message)
			throw new Error(`${messages.length} hiccups:${os.EOL}${messages.join(os.EOL)}`)
		}
	}
	if (!isDryRun) {
		await Promise.all(Array.from(teams, ([name, personEmails]) => onboardTeam({ name }, ...personEmails)))
	}
	return teams
}

if (!module.parent) {
	/* eslint-disable no-console */
	const rosters = process.argv.slice(2)
	if (rosters.length === 0) {
		console.error(`USAGE: node ${__filename} roster1.txt roster2.txt ...`)
		console.error('# filename (w/o .txt) is team name; contents are lines w/ email addresses')
		process.exit() // eslint-disable-line no-process-exit
	}
	const { CISCOSPARK_ACCESS_TOKEN, DRY_RUN } = Object(process.env)
	const isDryRun = Boolean(JSON.parse(DRY_RUN || 'false')) // or true
	const keys = Array.from(rosters, roster => roster.replace(/\.txt$/, ''))
	const values = Array.from(rosters, roster => path.resolve(process.cwd(), roster))
	onboardTeams(CISCOSPARK_ACCESS_TOKEN, _.zipObject(keys, values), isDryRun)
		.then((result) => {
			for (const [teamName, personEmailSet] of result) {
				console.log(`created team (name: ${teamName}) w/ ${personEmailSet.size + 1} member(s)`)
			}
		})
		.catch((reason) => {
			console.error(reason)
			process.exitCode = 1
		})
}
