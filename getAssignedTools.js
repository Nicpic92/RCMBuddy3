// functions/getAssignedTools.js

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
    // This function can be a GET request as it's retrieving data
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
    const requestingUser = authResult.user; // This user is authenticated

    try {
        const client = await createDbClient();

        try {
            // 2. Query the database for tools assigned to this user
            const result = await client.query(
                `SELECT
                    t.id AS tool_id,
                    t.name AS tool_name,
                    t.description AS tool_description,
                    ut.assigned_at
                 FROM user_tools ut
                 JOIN tools t ON ut.tool_id = t.id
                 WHERE ut.user_id = $1`,
                [requestingUser.userId]
            );

            const assignedTools = result.rows;

            return {
                statusCode: 200,
                body: JSON.stringify({
                    message: 'Assigned tools retrieved successfully.',
                    tools: assignedTools
                }),
            };

        } catch (dbError) {
            console.error('Database query error (getAssignedTools):', dbError);
            return {
                statusCode: 500,
                body: JSON.stringify({ message: 'Database operation failed.', error: dbError.message }),
            };
        } finally {
            await client.end(); // Close the client connection
        }

    } catch (generalError) {
        console.error('General Error (getAssignedTools):', generalError);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'An unexpected error occurred.', error: generalError.message }),
        };
    }
};
