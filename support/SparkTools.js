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

const base64url = (...args) => {
	const buffer = Buffer.from(...args).toString('base64')
	return buffer.replace('+', '-').replace('/', '_').replace(/=+$/, '')
}

const decodeUUID = (encoded, encoding = 'base64') => {
	const decoded = Buffer.from(encoded, encoding).toString()
	return decoded.slice(decoded.lastIndexOf('/') + 1)
}

const createdDate = ({ created }) => created ? new Date(created) : new Date() // default: now
const MOST_RECENTLY_CREATED_FIRST = (lhs, rhs) => Math.sign(createdDate(rhs) - createdDate(lhs))

/**
 * Make requests and parse responses from public Spark APIs. Add methods to support scripts.
 *
 * Try to follow conventions of existing methods, and delegate/re-use when it makes sense to do so.
 *
 * To ignore auto-page/retry mechanism(s), specify page/retry: false (in options or on class instances)
 *
 * As a general rule, try to remain orderly: don't add unnecessary plumbing, and keep porcelian consistent.
 */
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
				if (!this.page || !request.page || !response.headers.has('link')) {
					return response.json() // can't or won't (so don't) auto-page
				}
				return this.page(response, request)
			case 201: // Created
				return response.json()
			case 204: // No Content
				return
			case 401: // Unauthorized
				throw new SparkError('access token is invalid (get a new one from dev.ciscospark.com)')
			case 429: // Too Many Requests
				//if (!this.retry || !request.retry || !response.headers.has('retry-after')) { // sometimes missing?!
				if (!this.retry || !request.retry) {
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
			const linkHeader = response.headers.get('link')
			const nextURLs = /<(.+?)>; rel="next"/g.exec(linkHeader)
			const nextURL = _.get(nextURLs, 1) // may be undefined
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
		const response = await fetch(url, options).catch(error => error)
		const [s, ns] = process.hrtime(hrtime)
		// e.g. GET /v1/people/me => 200 OK (in 0.200s)
		log.debug('fetch: %s %s => %s %s (in %ss)',
			options.method || 'GET',
			url || options.url || '/',
			String(Number(response.status) || 0),
			SparkError.statusMessage(response),
			Number(s + ns / 1e9).toFixed(3),
		)
		if (response instanceof Error) throw response
		return response
	}

	async addMembershipToTeam ({ personEmail }, team, isModerator = false) {
		const teamId = _.get(team, 'id', team)
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

	async getTeamMembership (person, team) {
		const personUUID = decodeUUID(_.get(person, 'id', person))
		const teamUUID = decodeUUID(_.get(team, 'id', team))
		const id = base64url(`ciscospark://us/TEAM_MEMBERSHIP/${personUUID}:${teamUUID}`)
		return this.json(`/v1/team/memberships/${id}`)
	}

	async listTeamMemberships ({ teamId }) {
		const query = querystring.stringify({ max: MAX_PAGE_SIZE, teamId })
		const { items } = await this.json(`/v1/team/memberships?${query}`)
		return items
	}

	async listTeams (...args) {
		const options = Object.assign({ max: MAX_PAGE_SIZE }, ...args)
		const query = querystring.stringify(_.pick(options, QUERY_OPTIONS))
		const { items } = await this.json(`/v1/teams?${query}`)
		return items
	}

	async listTeamsModeratedByMe (...args) {
		const me = await this.getPersonDetails()
		const teams = await this.findTeams(...args)
		const isModerator = await Promise.all(teams.map(async (team) => {
			const myTeamMembership = await this.getTeamMembership(me, team)
			return myTeamMembership.isModerator // if false, team filtered out
		}))
		return teams.filter((team, index) => isModerator[index]).sort(MOST_RECENTLY_CREATED_FIRST)
	}

	static fromAccessToken (token) {
		return new SparkTools(token)
	}

}

module.exports = SparkTools
