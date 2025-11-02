const userRouter = require('./user')
const documentRouter = require('./document')
const authRouter = require('./auth')

const route = (app) => {
    app.use(`/user`, userRouter)
    app.use(`/document`, documentRouter)
    app.use(`/auth`, authRouter)
}

module.exports = route;