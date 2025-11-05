const userRouter = require('./user')
const documentRouter = require('./document')
const authRouter = require('./auth')
const departmentRouter = require('./department')

const route = (app) => {
    app.use(`/user`, userRouter)
    app.use(`/document`, documentRouter)
    app.use(`/auth`, authRouter)
    app.use(`/department`, departmentRouter)
}

module.exports = route;