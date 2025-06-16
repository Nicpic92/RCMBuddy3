// functions/assignTool.js

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
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: JSON.stringify({ message: 'Method Not Allowed' }),
        };
    }

    // 1. Authenticate the request and get the requesting user's info
    const authResult = authHelper.verifyToken(event);
    if (authResult.statusCode !== 200) {
        return authResult; // Return authentication error
    }
    const requestingUser = authResult.user;

    // 2. Authorize the user: Must be an admin or superadmin
    if (!authHelper.hasRole(requestingUser, 'admin')) {
        return {
            statusCode: 403, // Forbidden
            body: JSON.stringify({ message: 'Access denied. Admin or Superadmin role required.' }),
        };
    }

    try {
        const { targetUserId, toolId } = JSON.parse(event.body);

        if (!targetUserId || !toolId) {
            return {
                statusCode: 400,
                body: JSON.stringify({ message: 'Missing targetUserId or toolId.' }),
            };
        }

        const client = await createDbClient();

        try {
            await client.query('BEGIN'); // Start transaction

            // 3. Validate target user: Must exist and belong to the requesting admin's company
            const targetUserResult = await client.query(
                'SELECT company_id, is_active FROM users WHERE id = $1',
                [targetUserId]
            );

            if (targetUserResult.rows.length === 0 || !targetUserResult.rows[0].is_active) {
                await client.query('ROLLBACK');
                return {
                    statusCode: 404, // Not Found
                    body: JSON.stringify({ message: 'Target user not found or is inactive.' }),
                };
            }

            const targetUserCompanyId = targetUserResult.rows[0].company_id;

            if (targetUserCompanyId !== requestingUser.companyId && requestingUser.role !== 'superadmin') {
                await client.query('ROLLBACK');
                return {
                    statusCode: 403, // Forbidden
                    body: JSON.stringify({ message: 'Admins can only assign tools to users within their own company.' }),
                };
            }

            // 4. Validate tool availability: Check if the tool is global or available to the admin's company
            const toolAvailabilityResult = await client.query(
                `SELECT t.id FROM tools t
                 LEFT JOIN company_tools ct ON t.id = ct.tool_id
                 WHERE t.id = $1 AND (t.is_global = TRUE OR ct.company_id = $2)`,
                [toolId, requestingUser.companyId]
            );

            if (toolAvailabilityResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return {
                    statusCode: 404, // Not Found
                    body: JSON.stringify({ message: 'Tool not found or not available to your company.' }),
                };
            }

            // 5. Check if user already has this tool assigned
            const existingAssignment = await client.query(
                'SELECT 1 FROM user_tools WHERE user_id = $1 AND tool_id = $2',
                [targetUserId, toolId]
            );
            if (existingAssignment.rows.length > 0) {
                await client.query('ROLLBACK');
                return {
                    statusCode: 409, // Conflict
                    body: JSON.stringify({ message: 'User already has this tool assigned.' }),
                };
            }

            // 6. Assign the tool to the user
            await client.query(
                'INSERT INTO user_tools(user_id, tool_id) VALUES($1, $2)',
                [targetUserId, toolId]
            );

            await client.query('COMMIT'); // Commit transaction

            return {
                statusCode: 200,
                body: JSON.stringify({ message: 'Tool assigned successfully to user.' }),
            };

        } catch (dbError) {
            await client.query('ROLLBACK'); // Rollback on any database error
            console.error('Database transaction error:', dbError);
            return {
                statusCode: 500,
                body: JSON.stringify({ message: 'Database operation failed.', error: dbError.message }),
            };
        } finally {
            await client.end(); // Close the client connection
        }

    } catch (parseError) {
        console.error('JSON Parse Error:', parseError);
        return {
            statusCode: 400,
            body: JSON.stringify({ message: 'Invalid JSON body.' }),
        };
    } catch (generalError) {
        console.error('General Error:', generalError);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'An unexpected error occurred.', error: generalError.message }),
        };
    }
};
