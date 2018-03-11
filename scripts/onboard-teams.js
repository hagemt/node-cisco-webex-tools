const fs = require('fs')
const path = require('path')

const _ = require('lodash')
const chalk = require('chalk')
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
	console.error(chalk.yellow('[WARNING]', anyString))
	// eslint-disable-next-line no-console
	console.error(chalk.yellow(`\t${anyError.message}`))
}

// promptName:AsyncFunction :: (optionallyNamed:Team, ...teams) => definitelyNamed:Team
// uses teams:Array<existing:Team> to assign name to Team, returned (extant IFF .id present)
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

// parseRouter:AsyncFunction :: (absolutePath:String) => teamRoster:Set<personEmail:String>
// read text file, extracting unique emails (see PARTICIPANT_LIMIT, VALID_EMAIL_ADDRESS)
const parseRoster = async (filename, encoding = 'utf8') => {
	// N.B. this method will be very slow for any large file passed as a roster (fs.readFileSync)
	const all = fs.readFileSync(filename, encoding).toString().split(/[,\s]+/g) // no safe limits?
	const set = new Set(all.filter(one => VALID_EMAIL_ADDRESS.test(one))) // better parse method?
	if (set.size > 0 && set.size < PARTICIPANT_LIMIT) return Object.assign(set, { filename })
	throw new Error(`email roster (size: ${set.size}) outside bounds: [1, ${PARTICIPANT_LIMIT})`)
}

// onboardTeams:AsyncFunction :: (files:Object, token:String, ...flags) => rosters:Map
// does the leg-work of onboarding Spark Teams, provided a set of roster files to parse
const onboardTeams = async (teamRosterFiles, userAccessToken, isDryRun, noPrompts) => {
	const delay = async (...args) => new Promise(done => setTimeout(done, ...args))
	const spark = SparkTools.fromAccessToken(userAccessToken)
	const onboardTeam = async ({ id, name }, ...personEmails) => {
		const createTeam = !!name && !id // will create a new team when only the name is provided (no team ID)
		const team = await (createTeam ? spark.createTeamAsModerator({ name }) : spark.getTeamDetails({ id }))
		const membershipsBefore = await spark.listTeamMemberships(team).then(all => _.keyBy(all, 'personEmail'))
		const addParticipantToTeamErrors = new Map() // useful for debug
		const addParticipantToTeam = async (personEmail, delayMS = 1000) => {
			try {
				if (delayMS > 0) await delay(delayMS) // avoid 429's
				await spark.addMembershipToTeam({ personEmail }, team)
			} catch (sparkError) {
				addParticipantToTeamErrors.set(personEmail, sparkError)
			}
		}
		for (const personEmail of personEmails) {
			if (!(personEmail in membershipsBefore)) {
				// TODO (tohagema): batch some requests?
				await addParticipantToTeam(personEmail)
			}
		}
		const membershipsAfter = await spark.listTeamMemberships(team).then(all => _.keyBy(all, 'personEmail'))
		for (const personEmail of personEmails) {
			if (!(personEmail in membershipsAfter)) {
				const message = `this person (email: ${personEmail}) does not hold membership in this team (name: ${team.name})`
				if (!addParticipantToTeamErrors.has(personEmail)) addParticipantToTeamErrors.set(personEmail, new Error(message))
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
			logWarning(`email roster (filename: ${filename}) format (one email per line) problem:`, parseError)
		}
	}
	const teamsModeratedByMe = await spark.listTeamsModeratedByMe().catch(() => [])
	const teamNamedID = ({ name }) => teamsModeratedByMe.some(team => team.id === name)
	const onboardTeamErrors = new Map() // useful for debug
	for (const [rosteredTeam, teamRoster] of teamRosters) {
		try {
			if (teamNamedID(rosteredTeam)) rosteredTeam.id = rosteredTeam.name // may set team id
			if (!noPrompts) await promptName(rosteredTeam, ...teamsModeratedByMe) // may set " name
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
	const { CISCOSPARK_ACCESS_TOKEN, CISCOSPARK_ROSTERS_PATH, DRY_RUN, NO_PROMPTS } = Object(process.env)
	const rostersPath = CISCOSPARK_ROSTERS_PATH || process.cwd() // optionally, keep rosters in this folder
	const parseBoolean = (maybeJSON, defaultJSON = 'null') => Boolean(JSON.parse(maybeJSON || defaultJSON))
	const [isDryRun, noPrompts] = [parseBoolean(DRY_RUN), parseBoolean(NO_PROMPTS) || !process.stdin.isTTY]
	const rosters = process.argv.slice(2) // each argument is an email roster file path
	if (!CISCOSPARK_ACCESS_TOKEN || rosters.length === 0) {
		console.error(chalk.red('USAGE: set CISCOSPARK_ACCESS_TOKEN and provide email rosters, or run tutorial'))
		process.exit(0) // eslint-disable-line no-process-exit
	}
	console.info(chalk.bold('This may take several seconds: will fetch full list of your teams from Spark...'))
	const names = Array.from(rosters, roster => path.parse(roster).name) // basename without file extension
	const paths = Array.from(rosters, roster => path.resolve(rostersPath, roster)) // absolute path to file
	onboardTeams(_.zipObject(names, paths), CISCOSPARK_ACCESS_TOKEN, isDryRun, noPrompts, 10) // slow
		.then((teamRosters) => {
			for (const [rosteredTeam, teamRoster] of teamRosters) {
				const [name, size] = [rosteredTeam.name, teamRoster.size]
				if (DRY_RUN) {
					console.info(chalk.green(`would onboard team (name: ${name}) email roster (size: ${size}) with:`))
					for (const personEmail of teamRoster) console.info(chalk.green(`\t${personEmail}`))
				} else {
					console.info(chalk.green(`finished onboarding team (name: ${name}) email roster (size: ${size})`))
				}
			}
		})
		.catch((reason) => {
			console.error(reason)
			process.exitCode = 1
		})
}
