const testRouter = require('./test')

const route = (app) => {
    app.use(`/test`, testRouter)
}

module.exports = route;