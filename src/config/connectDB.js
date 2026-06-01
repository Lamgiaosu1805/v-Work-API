const mongoose = require('mongoose');

const connect = async () => {
    await mongoose.connect(process.env.MONGODB_URI, {
        maxPoolSize: 50,
        minPoolSize: 10,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
        retryWrites: true,
    });
    console.log("DB connected");
}

module.exports = { connect };