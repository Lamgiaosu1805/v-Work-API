const router = require("express").Router();
const { authenticate, canManage } = require("../middlewares/authMiddleware");
const { upload, convertHeic } = require("../middlewares/uploadFeed");
const PostController = require("../controllers/PostController");

router.get("/", authenticate, PostController.getPosts);
router.post("/", authenticate, upload.array("images", 4), convertHeic, PostController.createPost);
router.post("/:id/react", authenticate, PostController.reactPost);
router.delete("/:id", authenticate, PostController.deletePost);
router.patch("/:id/pin", authenticate, canManage("workplace"), PostController.pinPost);
router.get("/:id/comments", authenticate, PostController.getComments);
router.post("/:id/comments", authenticate, PostController.createComment);
router.delete("/:id/comments/:commentId", authenticate, PostController.deleteComment);

module.exports = router;
