// functions/deactivateUser.js

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
    if (event.httpMethod !== 'POST') { // Or PUT/PATCH, POST is fine for now
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
        const { targetUserId } = JSON.parse(event.body);

        if (!targetUserId) {
            return {
                statusCode: 400,
                body: JSON.stringify({ message: 'Missing targetUserId.' }),
            };
        }

        const client = await createDbClient();

        try {
            await client.query('BEGIN'); // Start a transaction

            // 3. Get target user's details for validation
            const targetUserResult = await client.query(
                'SELECT company_id, role, is_active FROM users WHERE id = $1',
                [targetUserId]
            );

            const targetUser = targetUserResult.rows[0];

            if (!targetUser) {
                await client.query('ROLLBACK');
                return {
                    statusCode: 404, // Not Found
                    body: JSON.stringify({ message: 'Target user not found.' }),
                };
            }

            // Prevent deactivating oneself
            if (targetUserId === requestingUser.userId) {
                await client.query('ROLLBACK');
                return {
                    statusCode: 403, // Forbidden
                    body: JSON.stringify({ message: 'Cannot deactivate your own account through this endpoint.' }),
                };
            }

            // Prevent admin from deactivating other admins or superadmins, unless requesting user is superadmin
            if (targetUser.role === 'admin' || targetUser.role === 'superadmin') {
                if (requestingUser.role !== 'superadmin') {
                     await client.query('ROLLBACK');
                     return {
                        statusCode: 403,
                        body: JSON.stringify({ message: 'Admins cannot deactivate other admins or superadmins.' }),
                    };
                }
            }


            // 4. Validate company affiliation (unless requesting user is superadmin)
            if (requestingUser.role !== 'superadmin' && targetUser.company_id !== requestingUser.companyId) {
                await client.query('ROLLBACK');
                return {
                    statusCode: 403, // Forbidden
                    body: JSON.stringify({ message: 'Admins can only deactivate users within their own company.' }),
                };
            }

            // 5. Check if user is already inactive
            if (!targetUser.is_active) {
                await client.query('ROLLBACK');
                return {
                    statusCode: 409, // Conflict
                    body: JSON.stringify({ message: 'User is already inactive.' }),
                };
            }

            // 6. Deactivate the user
            await client.query(
                'UPDATE users SET is_active = FALSE WHERE id = $1',
                [targetUserId]
            );

            await client.query('COMMIT'); // Commit the transaction

            return {
                statusCode: 200,
                body: JSON.stringify({ message: 'User deactivated successfully.' }),
            };

        } catch (dbError) {
            await client.query('ROLLBACK'); // Rollback on error
            console.error('Database transaction error (deactivateUser):', dbError);
            return {
                statusCode: 500,
                body: JSON.stringify({ message: 'Database operation failed.', error: dbError.message }),
            };
        } finally {
            await client.end(); // Close the client connection
        }

    } catch (parseError) {
        console.error('JSON Parse Error (deactivateUser):', parseError);
        return {
            statusCode: 400,
            body: JSON.stringify({ message: 'Invalid JSON body.' }),
        };
    } catch (generalError) {
        console.error('General Error (deactivateUser):', generalError);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'An unexpected error occurred.', error: generalError.message }),
        };
    }
};
