/* eslint-env mocha */
const assert = require('assert')
const UUID = require('uuid')

// eslint-disable-next-line node/no-unpublished-require
const nock = require('nock') // to mock HTTP requests
const SparkTools = require('../support/SparkTools.js')

describe('SparkTools', () => {

	const newSparkTools = async token => SparkTools.fromAccessToken(token)

	describe('.fromAccessToken', () => {

		it('will return a unique instance of SparkTools', async () => {
			const [one, two] = await Promise.all([newSparkTools('one'), newSparkTools('two')]) // unique
			assert(one instanceof SparkTools && two instanceof SparkTools && one !== two, 'not unique')
		})

		it('will throw TypeError if not provided a Bearer token', async () => {
			const error = await newSparkTools('').catch(thrownError => thrownError)
			assert(error instanceof TypeError, 'expected TypeError thrown due to empty token')
			assert(error.message.includes('export CISCOSPARK_ACCESS_TOKEN'), 'expected mention of env')
			assert(error.message.includes('dev.ciscospark.com'), 'expected mention of developer portal')
		})

	})

	const fakeResources = () => {
		const base64url = (...args) => {
			const id = Buffer.from(...args).toString('base64') // make URL safe:
			return id.replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-')
		}
		const fakeResource = (type, ...args) => {
			const id = base64url(`ciscospark://us/${type}/${UUID.v4()}`)
			const created = new Date().toISOString() // won't match UUID
			return Object.freeze(Object.assign({ created, id }, ...args))
		}
		// N.B. these are all strict subsets of real ones
		const fakePerson = fakeResource('PERSON', {
			displayName: 'Fake Person',
		})
		return {
			person: fakePerson,
		}
	}

	describe('porcelian', () => {

		const test = {
			token: 'CISCOSPARK_ACCESS_TOKEN',
		}

		before(async () => {
			nock.disableNetConnect()
		})

		describe('#getPersonDetails', () => {

			before(async () => {
				Object.assign(test, fakeResources())
				test.nock = nock('https://api.ciscospark.com')
					.get(uri => uri === '/v1/people/me')
					.reply(200, test.person)
				test.tools = await newSparkTools(test.token)
			})

			it('can get details on a person', async () => {
				const person = await test.tools.getPersonDetails()
				assert.deepStrictEqual(person, test.person)
			})

			after(() => {
				test.nock.done()
				nock.cleanAll()
			})

		})

		after(async () => {
			nock.enableNetConnect()
		})

	})

})
