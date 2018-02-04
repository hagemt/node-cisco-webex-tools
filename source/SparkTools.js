const querystring = require('querystring')
const url = require('url')

const _ = require('lodash')
const fetch = require('node-fetch')

const log = require('./log.js')
const SparkError = require('./SparkError.js')

const DEFAULT_ORIGIN = process.env.CISCOSPARK_URL_ORIGIN || 'https://api.ciscospark.com'
const buildURL = (uri, origin = DEFAULT_ORIGIN) => new url.URL(uri, origin).toString()

const QUERY_OPTIONS = Object.freeze(['max'])
const MAX_PAGE_SIZE = 1000 // default ?max=

const JSON_MEDIA_TYPE = 'application/json'
const DEFAULT_HEADERS = Object.freeze({
	'accept': JSON_MEDIA_TYPE,
	'content-type': JSON_MEDIA_TYPE,
})

const parseFirstNextLink = (...args) => {
	const joined = [].concat(...args).join('\n')
	const matches = /<(.*)>; rel="next"/g.exec(joined)
	return _.get(matches, 1) // otherwise, undefined
}

class SparkTools {

	// constructor signature is volatile; use static factory methods
	constructor (userAccessToken = process.env.CISCOSPARK_ACCESS_TOKEN) {
		if (!userAccessToken || typeof userAccessToken !== 'string') {
			throw new TypeError('export CISCOSPARK_ACCESS_TOKEN=... # from dev.ciscospark.com')
		}
		this.json = async (uri, options) => {
			const requestURL = buildURL(uri) // using the DEFAULT_ORIGIN (since no second [origin] parameter is provided)
			const headers = Object.assign({ authorization: `Bearer ${userAccessToken}` }, DEFAULT_HEADERS, _.get(options, 'headers'))
			const request = Object.assign({ method: 'GET', page: true, retry: true, url: requestURL }, options, { headers })
			if (typeof request.body === 'object') request.body = JSON.stringify(request.body)
			const response = await this.fetch(requestURL, request)
			switch (response.status) {
			case 200: // OK
				if (!request.page || !response.headers.has('link')) {
					return response.json() // don't/can't page
				}
				return this.page(response, request)
			case 201: // Created
				return response.json()
			case 204: // No Content
				return
			case 401: // Unauthorized
				throw new SparkError('access token is invalid (get a new one from dev.ciscospark.com)')
			case 429: // Too Many Requests
				if (!request.retry || !response.headers.has('retry-after')) {
					throw new SparkError('sent Too Many Requests (according to Spark) and will not retry')
				}
				return SparkError.retryAfter(response.headers.get('retry-after'), async () => this.json(uri, options))
			default:
				throw await SparkError.fromResponse(response).catch(nonSparkError => nonSparkError)
			}
		}
		this.page = async (response, request, array = []) => {
			const { items } = await response.json()
			for (const item of items) array.push(item)
			const linkHeaders = response.headers.get('link')
			const nextURL = parseFirstNextLink(linkHeaders)
			if (!nextURL) return { items: array } // done
			const next = await this.fetch(nextURL, {
				// same Authorization, etc.
				headers: request.headers,
			})
			return this.page(next, request, array)
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

	async addParticipantToTeam (personEmail, teamId, isModerator = false) {
		log.debug('add (moderator: %s) participant (email: %s) to team (id: %s)',
			isModerator ? 'true' : 'false',
			personEmail,
			teamId,
		)
		return this.json('/v1/team/memberships', {
			body: { isModerator, personEmail, teamId },
			method: 'POST',
		})
	}

	async createTeamAsModerator ({ name }) {
		log.debug('create team (name: %s)', name)
		return this.json('/v1/teams', {
			body: { name },
			method: 'POST',
		})
	}

	async getPersonDetails (person = 'me') {
		const id = _.get(person, 'id', person)
		return this.json(`/v1/people/${id}`)
	}

	async getTeamDetails (team) {
		const id = _.get(team, 'id', team)
		if (!id) throw new Error('no team.id')
		return this.json(`/v1/teams/${id}`)
	}

	async findTeams (...args) {
		const options = Object.assign({ max: MAX_PAGE_SIZE }, ...args)
		const query = querystring.stringify(_.pick(options, QUERY_OPTIONS))
		const { items } = await this.json(`/v1/teams?${query}`)
		return items
	}

	async findTeamMembership (personId, teamId) {
		/*
		const encodeID = (suffix, prefix = 'ciscospark://us/TEAM_MEMBERSHIP/') => {
			const encoded = Buffer.from(`${prefix}${suffix}`).toString('base64')
			return encoded.replace('+', '-').replace('/', '_').replace(/=+$/, '')
		}
		const decodeUUID = (encoded, encoding = 'base64') => {
			const decoded = Buffer.from(encoded, encoding).toString()
			return decoded.slice(decoded.lastIndexOf('/') + 1)
		}
		// this should work in concept, but it's really gross
		const personUUID = decodeUUID(personId) // base64url
		const teamUUID = decodeUUID(teamId) // also base64url
		const id = encodeID(`${personUUID}:${teamUUID}`)
		return this.json(`/v1/team/memberships/${id}`)
		*/
		const query = querystring.stringify({ max: 1, personId, teamId })
		const { items } = await this.json(`/v1/team/memberships?${query}`)
		if (_.get(items, 0)) return items[0] // otherwise, fail loudly:
		const parties = `person (id: ${personId}) and team (id: ${teamId})`
		throw new Error(`found no membership relation between ${parties}`)
	}

	async findTeamsModeratedByMe () {
		const me = await this.getPersonDetails()
		const teams = await this.findTeams()
		const isModerator = await Promise.all(teams.map(async (team) => {
			const myTeamMembership = await this.findTeamMembership(me.id, team.id)
			return myTeamMembership.isModerator // if false, team filtered out
		}))
		const BY_CREATED_DATE = (lhs, rhs) => Math.sign(+new Date(rhs) - +new Date(lhs))
		return teams.filter((team, index) => isModerator[index]).sort(BY_CREATED_DATE)
	}

	static fromAccessToken (token) {
		return new SparkTools(token)
	}

}

module.exports = SparkTools
