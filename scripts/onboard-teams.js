const fs = require('fs')
const path = require('path')

const _ = require('lodash')
const inquirer = require('inquirer')

const SparkTools = require('../source/SparkTools.js')
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

const onboardTeams = async (userAccessToken, teamRosterFiles, isDryRun) => {
	const spark = SparkTools.fromAccessToken(userAccessToken)
	const onboardTeam = async ({ id, name }, ...participantEmails) => {
		const createTeam = !!name && !id // create a team if only the name is provided (no team ID)
		const team = await (createTeam ? spark.createTeamAsModerator({ name }) : spark.getTeam({ id }))
		const addParticipantToTeamErrors = new Map() // useful for debug
		for (const participantEmail of participantEmails) {
			try {
				await spark.addParticipantToTeam(participantEmail, team.id)
			} catch (sparkError) {
				addParticipantToTeamErrors.set(participantEmail, sparkError)
			}
		}
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
			//teamRosters.set({ name: filename }, { error: parseError })
			logWarning(`email roster (filename: ${filename}) format (one email per line) problem:`, parseError)
		}
	}
	if (!isDryRun) {
		const teams = await spark.getTeamsModeratedByMe().catch(() => [])
		const onboardTeamErrors = new Map() // useful for debug
		for (const [rosteredTeam, teamRoster] of teamRosters) {
			try {
				// TODO: should support some non-interactive use cases?
				const team = await promptName(rosteredTeam, ...teams)
				teams.push(await onboardTeam(team, ...teamRoster))
			} catch (sparkError) {
				onboardTeamErrors.set(rosteredTeam, sparkError)
			}
		}
		for (const [targetTeam, sparkError] of onboardTeamErrors) {
			logWarning(`failed to onboard team (name: ${targetTeam.name}) due to:`, sparkError)
		}
	}
	return teamRosters
}

if (!module.parent) {
	/* eslint-disable no-console */
	const rosters = process.argv.slice(2)
	if (rosters.length === 0) {
		console.error(`USAGE: node ${__filename} roster1.txt roster2.txt ...`)
		console.error('# filename (w/o .txt) is new team name; for existing team, use $id.txt; rosters list email addresses')
		process.exit() // eslint-disable-line no-process-exit
	}
	const { BASE_PATH, CISCOSPARK_ACCESS_TOKEN, DRY_RUN } = Object(process.env)
	const basePath = BASE_PATH || process.cwd() // default: current working dir
	const isDryRun = Boolean(JSON.parse(DRY_RUN || 'null')) // default: false
	const keys = Array.from(rosters, roster => roster.replace(/\.txt$/, ''))
	const values = Array.from(rosters, roster => path.resolve(basePath, roster))
	onboardTeams(CISCOSPARK_ACCESS_TOKEN, _.zipObject(keys, values), isDryRun)
		.then((teamRosters) => {
			for (const [rosteredTeam, teamRoster] of teamRosters) {
				if (DRY_RUN) {
					console.info(`onboarding team (name: ${rosteredTeam.name}) email roster (size: ${teamRoster.size}) dry run:`)
				} else {
					console.info(`onboarding team (name: ${rosteredTeam.name}) email roster (size: ${teamRoster.size}) attempted:`)
				}
				for (const personEmail of teamRoster) {
					console.info(`\t${personEmail}`)
				}
			}
		})
		.catch((reason) => {
			console.error(reason)
			process.exitCode = 1
		})
}
