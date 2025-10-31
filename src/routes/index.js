const userRouter = require('./user')

const route = (app) => {
    app.use(`/user`, userRouter)
}

module.exports = route;