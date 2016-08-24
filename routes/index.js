var express = require('express');
var router = express.Router();

router.get('/', function (req, res, next) {
    res.render('home')
});

router.get('/:template/:page', function (req, res, next) {
    res.render(req.params.page, {layout: req.params.template})
});

module.exports = router;
