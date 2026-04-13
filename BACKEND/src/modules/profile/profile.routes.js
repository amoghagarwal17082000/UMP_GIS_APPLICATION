const express= require('express');
const router = express.Router(); 
const { updateProfile, validatePassword } = require('./profile.controller');

console.log("profile routes comes");


router.post('/profile/validate-password', validatePassword)
router.post('/profile', updateProfile )

module.exports = router; 
