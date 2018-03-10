/* eslint-env mocha */
const assert = require('assert')
const querystring = require('querystring')

const validation = require('../support/validation.js')

describe('validation', () => {

	const assertPositive = (baseURI, queryOptions, assertionString) => {
		const actualURI = validation.buildURI(baseURI, queryOptions)
		const expectedURI = `${baseURI}?${querystring.stringify(queryOptions)}`
		assert.equal(actualURI, expectedURI, assertionString || 'unexpected URI')
	}

	const assertNegative = (foreignObject, propertyName, messageExpected) => {
		const t = f => { try { f() } catch (e) { return e } } // eslint-disable-line
		const expectedError = t(() => assertPositive(foreignObject, propertyName))
		assert(expectedError instanceof Error, `unexpected success (${messageExpected})`)
		const assertionMessage = `unexpected failure message (${expectedError.message})`
		return assert.equal(expectedError.message, messageExpected, assertionMessage)
	}

	it('can validate list teams queries', () => {
		assertNegative('/v1/teams', { max: 0 }, '"max" must be larger than or equal to 1')
		assertNegative('/v1/teams', { max: 1001 }, '"max" must be less than or equal to 1000')
		assertPositive('/v1/teams', { max: undefined }) // eslint-disable-line no-undefined
		assertPositive('/v1/teams', { max: 1 })
		assertPositive('/v1/teams', { max: 10 })
		assertPositive('/v1/teams', { max: 100 })
		assertPositive('/v1/teams', { max: 1000 })
	})

})
