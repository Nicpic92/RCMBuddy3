// functions/getAvailableTools.js

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
            // 3. Query the database for tools that are either global OR linked to the requesting admin's company
            const result = await client.query(
                `SELECT
                    t.id AS tool_id,
                    t.name AS tool_name,
                    t.description AS tool_description,
                    t.is_global
                 FROM tools t
                 LEFT JOIN company_tools ct ON t.id = ct.tool_id
                 WHERE t.is_global = TRUE OR ct.company_id = $1
                 ORDER BY t.name ASC`,
                [requestingUser.companyId]
            );

            const availableTools = result.rows;

            return {
                statusCode: 200,
                body: JSON.stringify({
                    message: 'Available tools retrieved successfully.',
                    tools: availableTools
                }),
            };

        } catch (dbError) {
            console.error('Database query error (getAvailableTools):', dbError);
            return {
                statusCode: 500,
                body: JSON.stringify({ message: 'Database operation failed.', error: dbError.message }),
            };
        } finally {
            await client.end(); // Close the client connection
        }

    } catch (generalError) {
        console.error('General Error (getAvailableTools):', generalError);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'An unexpected error occurred.', error: generalError.message }),
        };
    }
};
