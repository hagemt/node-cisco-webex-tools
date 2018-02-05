const fs = require('fs')
const path = require('path')

const _ = require('lodash')
const inquirer = require('inquirer')

const SparkTools = require('../support/SparkTools.js')
const newSeparator = line => new inquirer.Separator(line)

const CHOICES_PAGE_SIZE = process.stdout.rows || 10
const DEFAULT_NEW_TEAM_NAME = 'My newest Spark Team'
const NEW_TEAM_CHOICE = 'Create a new Spark Team'
const PARTICIPANT_LIMIT = 5000 // for Space/Team
const VALID_EMAIL_ADDRESS = /^[^@]+@[^@]+$/

// TODO: this probably needs improvement:
const logWarning = (anyString, anyError) => {
	// eslint-disable-next-line no-console
	console.error('[WARNING]', anyString)
	// eslint-disable-next-line no-console
	console.error(`\t${anyError.message}`)
}

const promptName = async (team = {}, ...teams) => {
	const teamsByChoice = _.keyBy(teams, ({ created, name }) => `${name} (created: ${created})`)
	const teamChoices = [newSeparator(), NEW_TEAM_CHOICE, newSeparator()].concat(Object.keys(teamsByChoice))
	const askWhichTeam = Object.freeze({
		choices: Object.freeze(teamChoices),
		default: NEW_TEAM_CHOICE,
		message: 'Onboard into which Spark Team?',
		name: 'askWhichTeam',
		pageSize: CHOICES_PAGE_SIZE,
		type: 'list',
	})
	const askTeamName = Object.freeze({
		default: team.name || DEFAULT_NEW_TEAM_NAME,
		message: 'Name for new Spark Team?',
		name: 'askTeamName',
		when: answers => answers[askWhichTeam.name] === NEW_TEAM_CHOICE,
	})
	const questions = [askWhichTeam, askTeamName]
	const answers = await inquirer.prompt(questions)
	// https://www.npmjs.com/package/inquirer#examples
	const existingTeam = teamsByChoice[answers[askWhichTeam.name]]
	if (existingTeam) Object.assign(team, existingTeam)
	else team.name = answers[askTeamName.name]
	return team
}

const parseRoster = async (filename) => {
	const all = fs.readFileSync(filename).toString().split(/[,\s]+/g) // limit split if possible?
	const set = new Set(all.filter(one => VALID_EMAIL_ADDRESS.test(one))) // better parse method?
	if (set.size > 0 && set.size < PARTICIPANT_LIMIT) return Object.assign(set, { filename })
	throw new Error(`email roster (size: ${set.size}) outside bounds: [1, ${PARTICIPANT_LIMIT})`)
}

const onboardTeams = async (teamRosterFiles, userAccessToken, isDryRun, noPrompts, safe) => {
	const spark = SparkTools.fromAccessToken(userAccessToken)
	const onboardTeam = async ({ id, name }, ...personEmails) => {
		const createTeam = !!name && !id // will create a new team when only the name is provided (no team ID)
		const team = await (createTeam ? spark.createTeamAsModerator({ name }) : spark.getTeamDetails({ id }))
		const addParticipantToTeamErrors = new Map() // useful for debug
		const addParticipantToTeam = async (personEmail) => {
			try {
				await spark.addParticipantToTeam(personEmail, team.id)
			} catch (sparkError) {
				addParticipantToTeamErrors.set(personEmail, sparkError)
			}
		}
		if (!safe) await Promise.all(personEmails.map(addParticipantToTeam)) // likely 429s
		else for (const personEmail of personEmails) await addParticipantToTeam(personEmail)
		for (const [personEmail, sparkError] of addParticipantToTeamErrors) {
			logWarning(`failed to add person (email: ${personEmail}) to team (name: ${team.name}) due to:`, sparkError)
		}
		return team
	}
	const teamRosters = new Map() // from team:Object => personEmails:Set<String>
	for (const [teamname, filename] of Object.entries(teamRosterFiles)) {
		try {
			teamRosters.set({ name: teamname }, await parseRoster(filename))
		} catch (parseError) {
			logWarning(`email roster (filename: ${filename}) format (one email per line) problem:`, parseError)
		}
	}
	const teamsModeratedByMe = await spark.findTeamsModeratedByMe().catch(() => []) // always create team, unless:
	const teamNamedID = ({ name }) => /^ciscospark:\/\/us\/TEAM\/[0-9-a-f]{36}$/.test(Buffer.from(name, 'base64'))
	const onboardTeamErrors = new Map() // useful for debug
	for (const [rosteredTeam, teamRoster] of teamRosters) {
		try {
			if (teamNamedID(rosteredTeam)) rosteredTeam.id = rosteredTeam.name // dirty hack
			if (!noPrompts) await promptName(rosteredTeam, ...teamsModeratedByMe) // see above
			if (!isDryRun) teamsModeratedByMe.push(await onboardTeam(rosteredTeam, ...teamRoster))
		} catch (sparkError) {
			onboardTeamErrors.set(rosteredTeam, sparkError)
		}
	}
	for (const [targetTeam, sparkError] of onboardTeamErrors) {
		logWarning(`failed to onboard team (name: ${targetTeam.name}) due to:`, sparkError)
	}
	return teamRosters
}

module.exports = {
	onboardTeams,
	parseRoster,
	promptName,
}

if (!module.parent) {
	/* eslint-disable no-console */
	const rosters = process.argv.slice(2)
	if (rosters.length === 0) {
		console.error(`USAGE: node ${__filename} roster1.txt roster2.txt ...`)
		console.error('# filename (w/o .txt) is new team name; for existing team, use $id.txt; rosters list email addresses')
		process.exit() // eslint-disable-line no-process-exit
	}
	const parseBoolean = (maybeJSON, defaultJSON = 'null') => Boolean(JSON.parse(maybeJSON || defaultJSON))
	const { CISCOSPARK_ACCESS_TOKEN, CISCOSPARK_ROSTERS_PATH, DRY_RUN, NO_PROMPTS } = Object(process.env)
	const rostersPath = CISCOSPARK_ROSTERS_PATH || process.cwd() // optionally, keep rosters in this folder
	const [isDryRun, noPrompts] = [parseBoolean(DRY_RUN), parseBoolean(NO_PROMPTS) || !process.stdin.isTTY]
	const names = Array.from(rosters, roster => path.parse(roster).name) // basename without file extension
	const paths = Array.from(rosters, roster => path.resolve(rostersPath, roster)) // absolute path to file
	onboardTeams(_.zipObject(names, paths), CISCOSPARK_ACCESS_TOKEN, isDryRun, noPrompts, true) // dirty hack
		.then((teamRosters) => {
			for (const [rosteredTeam, teamRoster] of teamRosters) {
				if (DRY_RUN) {
					console.info(`would onboard team (name: ${rosteredTeam.name}) email roster (size: ${teamRoster.size}) with:`)
					for (const personEmail of teamRoster) console.info(`\t${personEmail}`)
				} else {
					console.info(`finished onboarding team (name: ${rosteredTeam.name}) email roster (size: ${teamRoster.size})`)
				}
			}
		})
		.catch((reason) => {
			console.error(reason)
			process.exitCode = 1
		})
}
