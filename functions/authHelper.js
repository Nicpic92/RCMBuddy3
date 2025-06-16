// functions/authHelper.js

const jwt = require('jsonwebtoken');

exports.verifyToken = (event) => {
    // 1. Get the token from the Authorization header
    const authHeader = event.headers.authorization;
    if (!authHeader) {
        return {
            statusCode: 401,
            body: JSON.stringify({ message: 'Authorization header missing.' }),
        };
    }

    const token = authHeader.split(' ')[1]; // Expects "Bearer <token>"
    if (!token) {
        return {
            statusCode: 401,
            body: JSON.stringify({ message: 'Token missing from Authorization header.' }),
        };
    }

    try {
        // 2. Verify the token using your JWT_SECRET
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // 3. Return the decoded user information
        return {
            statusCode: 200, // Indicate success
            user: decoded // Contains userId, username, role, companyId from JWT payload
        };

    } catch (error) {
        console.error('Token verification error:', error.message);
        // Handle different JWT errors
        if (error.name === 'TokenExpiredError') {
            return {
                statusCode: 401,
                body: JSON.stringify({ message: 'Token expired.' }),
            };
        }
        return {
            statusCode: 401,
            body: JSON.stringify({ message: 'Invalid token.' }),
        };
    }
};

// You can also add role-based authorization here or in the calling function
exports.hasRole = (user, requiredRole) => {
    const roles = {
        'standard': 1,
        'admin': 2,
        'superadmin': 3
    };
    if (!user || !user.role || !roles[user.role] || roles[user.role] < roles[requiredRole]) {
        return false;
    }
    return true;
};
