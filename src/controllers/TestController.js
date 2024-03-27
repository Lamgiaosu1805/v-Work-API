const TestController = {
    index: (req, res, next) => {
        res.json({
            a: 1,
            b: 2
        })
    }
}

module.exports = TestController;