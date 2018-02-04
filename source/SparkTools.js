const querystring = require('querystring')

const _ = require('lodash')
const fetch = require('node-fetch')

const log = require('./log.js')
const SparkError = require('./SparkError.js')

const BASE_URL = process.env.CISCOSPARK_BASE_URL || 'http://api.ciscospark.com'
const buildURL = (someURI, baseURL = BASE_URL) => `${baseURL}${someURI}`

const DEFAULT_HEADERS = Object.freeze({
	'Accept': 'application/json',
	'Content-Type': 'application/json',
})

class SparkTools {

	// constructor signature is volatile; use static factory methods
	constructor (userAccessToken = process.env.CISCOSPARK_ACCESS_TOKEN) {
		if (!userAccessToken || typeof userAccessToken !== 'string') {
			throw new TypeError('export CISCOSPARK_ACCESS_TOKEN=... # from dev.ciscospark.com')
		}
		this.json = async (uri, options) => {
			const requestURL = buildURL(uri)
			const Authorization = `Bearer ${userAccessToken}`
			const headers = Object.assign({ Authorization }, DEFAULT_HEADERS, options.headers)
			const request = Object.assign({ method: 'GET', url: requestURL }, options, { headers })
			const response = await this.fetch(requestURL, request)
			switch (response.status) {
			case 200: // OK
			case 201: // Created
				return response.json()
			case 204: // No Content
				return null
			case 401:
				throw new SparkError('access token is invalid (get a new one from dev.ciscospark.com)')
			case 429:
				if (!options.retry) {
					throw new SparkError('sent Too Many Requests (according to Spark) and will not retry')
				}
				return SparkError.retryAfter(response.get('retry-after'), () => this.json(uri, options))
			default:
				throw await SparkError.fromResponse(response).catch(nonSparkError => nonSparkError)
			}
		}
	}

	/* istanbul ignore next */
	async fetch (url, options) {
		const hrtime = process.hrtime()
		const response = await fetch(url, options)
		const [s, ns] = process.hrtime(hrtime)
		// e.g. GET /v1/people/me => 200 OK (in 0.200s)
		log.debug('fetch: %s %s => %s %s (in %ss)',
			options.method || 'GET',
			url || options.url || '/',
			String(response.status || 0),
			SparkError.statusMessage(response),
			Number(s + ns / 1e9).toFixed(3),
		)
		return response
	}

	// @SupportedMethod
	// @WriteOperation
	async addParticipantToTeam (personEmail, teamId, isModerator = false) {
		log.debug('add person (email: %s) to team (id: %s)', personEmail, teamId)
		return this.json('/v1/team/memberships', {
			body: JSON.stringify({ isModerator, personEmail, teamId }),
			method: 'POST',
		})
	}

	// @SupportedMethod
	// @WriteOperation
	async createTeamAsModerator ({ name }) {
		log.debug('create team (name: %s)', name)
		return this.json('/v1/teams', {
			body: JSON.stringify({ name }),
			method: 'POST',
		})
	}

	// @SupportedMethod
	async getPerson (person = 'me') {
		const id = _.get(person, 'id', person)
		return this.json(`/v1/people/${id}`)
	}

	// @SupportedMethod
	async getTeam (team) {
		const id = _.get(team, 'id', team)
		if (!id) throw new Error('no team.id')
		return this.json(`/v1/teams/${id}`)
	}

	// @SupportedMethod
	async getTeams () {
		// FIXME (tohagema): make this do pagination?
		const { items } = await this.json('/v1/teams', {
			method: 'GET',
		})
		return items
	}

	async getTeamMembership (personId, teamId) {
		/*
		const encodeID = (suffix, prefix = 'ciscospark://us/TEAM_MEMBERSHIP') => {
			const encoded = Buffer.from(`${prefix}${suffix}`).toString('base64')
			return encoded.replace('+', '-').replace('/', '_').replace(/=+$/, '')
		}
		const decodeUUID = (encoded, encoding = 'base64') => {
			const decoded = Buffer.from(encoded, encoding).toString()
			return decoded.slice(decoded.lastIndexOf('/') + 1)
		}
		const personUUID = decodeUUID(personId) // base64url
		const teamUUID = decodeUUID(teamId) // also base64url
		const id = encodeID(`${personUUID}:${teamUUID}`)
		return this.json(`/v1/team/memberships/${id}`)
		*/
		const query = querystring.stringify({ max: 1, personId, teamId })
		const { items } = await this.json(`/v1/team/memberships?${query}`)
		if (items.length === 1) return items[0] // else, throw:
		throw new Error('')
	}

	async getTeamsUnderMyModeration () {
		const me = await this.getPerson()
		const teams = await this.getTeams()
		const isModerator = await Promise.all(teams.map(async (team) => {
			const myTeamMembership = await this.getTeamMembership(me.id, team.id)
			return myTeamMembership.isModerator // Boolean
		}))
		const BY_CREATED_DATE = (lhs, rhs) => Math.sign(+new Date(rhs) - +new Date(lhs))
		return teams.filter((team, index) => isModerator[index]).sort(BY_CREATED_DATE)
	}

	static fromAccessToken (token) {
		return new SparkTools(token)
	}

}

module.exports = SparkTools
