// functions/getCompanyUsers.js

const { Client } = require('pg');
const authHelper = require('./authHelper'); // Import your authentication helper

// Helper function to create a database client
async function createDbClient() {
    const client = new Client({
        connectionString: process.env.NEON_DATABASE_URL,
        ssl: {
            rejectUnauthorized: false // Required for Neon's SSL on some environments
        }
    });
    await client.connect();
    return client;
}

exports.handler = async (event, context) => {
    // This is a GET request to retrieve data
    if (event.httpMethod !== 'GET') {
        return {
            statusCode: 405,
            body: JSON.stringify({ message: 'Method Not Allowed' }),
        };
    }

    // 1. Authenticate the request
    const authResult = authHelper.verifyToken(event);
    if (authResult.statusCode !== 200) {
        return authResult; // Return authentication error if token is missing/invalid
    }
    const requestingUser = authResult.user;

    // 2. Authorize the user: Must be an admin or superadmin
    if (!authHelper.hasRole(requestingUser, 'admin')) { // 'admin' role covers both admin and superadmin
        return {
            statusCode: 403, // Forbidden
            body: JSON.stringify({ message: 'Access denied. Admin or Superadmin role required.' }),
        };
    }

    try {
        const client = await createDbClient();

        try {
            // 3. Query the database for users in the requesting admin's company
            // Exclude password_hash for security
            // Optionally, exclude the requesting admin themselves from the list
            const result = await client.query(
                `SELECT
                    id,
                    username,
                    email,
                    role,
                    is_active,
                    created_at
                 FROM users
                 WHERE company_id = $1 AND id != $2 -- Get users in the same company, but not the admin themselves
                 ORDER BY username ASC`,
                [requestingUser.companyId, requestingUser.userId]
            );

            const companyUsers = result.rows;

            return {
                statusCode: 200,
                body: JSON.stringify({
                    message: 'Company users retrieved successfully.',
                    users: companyUsers
                }),
            };

        } catch (dbError) {
            console.error('Database query error (getCompanyUsers):', dbError);
            return {
                statusCode: 500,
                body: JSON.stringify({ message: 'Database operation failed.', error: dbError.message }),
            };
        } finally {
            await client.end(); // Close the client connection
        }

    } catch (generalError) {
        console.error('General Error (getCompanyUsers):', generalError);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'An unexpected error occurred.', error: generalError.message }),
        };
    }
};
