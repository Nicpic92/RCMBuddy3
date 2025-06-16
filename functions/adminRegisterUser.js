// functions/adminRegisterUser.js

const { Client } = require('pg');
const bcrypt = require('bcryptjs');
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

    // 1. Authenticate the request
    const authResult = authHelper.verifyToken(event);
    if (authResult.statusCode !== 200) {
        return authResult; // Return authentication error if token is missing/invalid
    }
    const requestingUser = authResult.user;

    // 2. Authorize the user: Must be an admin or superadmin
    if (!authHelper.hasRole(requestingUser, 'admin')) { // 'admin' covers both admin and superadmin based on hasRole logic
        return {
            statusCode: 403, // Forbidden
            body: JSON.stringify({ message: 'Access denied. Admin or Superadmin role required.' }),
        };
    }

    try {
        // Admin provides username, email, password for the new user
        const { username, email, password } = JSON.parse(event.body);

        if (!username || !email || !password) {
            return {
                statusCode: 400,
                body: JSON.stringify({ message: 'Missing required fields: username, email, or password.' }),
            };
        }

        const client = await createDbClient();

        try {
            await client.query('BEGIN'); // Start a transaction

            // 3. Check if username or email already exists for ANY user
            const existingUser = await client.query(
                'SELECT id FROM users WHERE username = $1 OR email = $2',
                [username, email]
            );
            if (existingUser.rows.length > 0) {
                await client.query('ROLLBACK');
                return {
                    statusCode: 409, // Conflict
                    body: JSON.stringify({ message: 'Username or email already exists.' }),
                };
            }

            // 4. Hash password for the new user
            const salt = await bcrypt.genSalt(10);
            const passwordHash = await bcrypt.hash(password, salt);

            // 5. Insert new user linked to the requesting admin's company
            const insertUserQuery = `
                INSERT INTO users(username, email, password_hash, company_id, role)
                VALUES($1, $2, $3, $4, $5) RETURNING id, username, email, role;
            `;
            const newUserResult = await client.query(
                insertUserQuery,
                [username, email, passwordHash, requestingUser.companyId, 'standard'] // New user defaults to 'standard' role in the admin's company
            );

            await client.query('COMMIT'); // Commit the transaction

            const newUser = newUserResult.rows[0];

            return {
                statusCode: 201, // Created
                body: JSON.stringify({
                    message: 'User registered successfully by admin!',
                    user: {
                        id: newUser.id,
                        username: newUser.username,
                        email: newUser.email,
                        role: newUser.role,
                        companyId: requestingUser.companyId
                    }
                }),
            };

        } catch (dbError) {
            await client.query('ROLLBACK'); // Rollback on error
            console.error('Database transaction error (adminRegisterUser):', dbError);
            return {
                statusCode: 500,
                body: JSON.stringify({ message: 'Database operation failed.', error: dbError.message }),
            };
        } finally {
            await client.end(); // Close the client connection
        }

    } catch (parseError) {
        console.error('JSON Parse Error (adminRegisterUser):', parseError);
        return {
            statusCode: 400,
            body: JSON.stringify({ message: 'Invalid JSON body.' }),
        };
    } catch (generalError) {
        console.error('General Error (adminRegisterUser):', generalError);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'An unexpected error occurred.', error: generalError.message }),
        };
    }
};
