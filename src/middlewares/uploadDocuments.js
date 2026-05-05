const upload = require('./uploadFile');
const DocumentTypeModel = require('../models/DocumentTypeModel');

module.exports = async (req, res, next) => {
  try {
    const docTypes = await DocumentTypeModel.find({ isDeleted: false });
    const fields = docTypes.map((doc) => ({ name: doc._id.toString(), maxCount: 10 }));
    upload.fields(fields)(req, res, (err) => {
      if (err) return res.status(400).json({ message: err.message });
      next();
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
