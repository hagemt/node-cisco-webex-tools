/* eslint-env node */
const assert = require('assert')

const success = () => {
	assert(true)
}

module.exports = success

if (!module.parent) {
	success()
}
