const express = require('express');
const DocumentController = require('../controllers/DocumentController');
const { isAdmin, authenticate } = require('../middlewares/authMiddleware');
const router = express.Router()


//GET
router.get("/documentTypes", async (req, res) => {
    try {
        const types = await DocumentTypeModel.find({ isDeleted: false });
        res.json(types);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

//POST
router.post('/createTypeDocument', authenticate, isAdmin, DocumentController.createTypeDocument);

module.exports = router;