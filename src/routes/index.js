const userRouter = require('./user')
const documentRouter = require('./document')
const authRouter = require('./auth')
const departmentRouter = require('./department')
const laborContractRouter = require('./laborContract')
const attendanceRouter = require('./attendance')
const referralRouter = require('./referral')
const customerRouter = require('./customer')
const appRouter = require('./app')
const agentRouter = require('./agent')

const route = (app) => {
    app.use(`/user`, userRouter)
    app.use(`/document`, documentRouter)
    app.use(`/auth`, authRouter)
    app.use(`/department`, departmentRouter)
    app.use(`/laborContract`, laborContractRouter)
    app.use(`/attendance`, attendanceRouter)
    app.use(`/referral`, referralRouter)
    app.use(`/customer`, customerRouter)
    app.use(`/app`, appRouter)
    app.use(`/agents`, agentRouter)
}

module.exports = route;