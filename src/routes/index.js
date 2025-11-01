const userRouter = require('./user')
const documentRouter = require('./document')

const route = (app) => {
    app.use(`/user`, userRouter)
    app.use(`/document`, documentRouter)
}

module.exports = route;