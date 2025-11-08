require('dotenv').config();
const express = require('express')
const app = express()
const route = require('./src/routes')
const morgan = require('morgan')
const db = require('./src/config/connectDB')

//use middlewares
app.use(morgan('dev'))
app.use(express.json())
app.use(express.urlencoded({
    extended: true
}))

// Request and Response logging middleware
app.use(require('./src/middlewares/loggingMiddleware'))

//routing
route(app);

//connectdb
db.connect()

const port = process.env.PORT || 3000

app.listen(port, () => {
  console.log(`App listening on port ${port}`)
})