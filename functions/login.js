// functions/login.js

const { Client } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken'); // For creating JWTs

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

    try {
        const { username, password } = JSON.parse(event.body);

        if (!username || !password) {
            return {
                statusCode: 400,
                body: JSON.stringify({ message: 'Username and password are required.' }),
            };
        }

        const client = await createDbClient();

        try {
            // 1. Find the user by username
            const userResult = await client.query(
                'SELECT id, username, email, password_hash, company_id, role, is_active FROM users WHERE username = $1',
                [username]
            );

            const user = userResult.rows[0];

            if (!user || !user.is_active) {
                // User not found or account is deactivated
                return {
                    statusCode: 401, // Unauthorized
                    body: JSON.stringify({ message: 'Invalid credentials or inactive account.' }),
                };
            }

            // 2. Compare the provided password with the stored hash
            const isPasswordValid = await bcrypt.compare(password, user.password_hash);

            if (!isPasswordValid) {
                return {
                    statusCode: 401, // Unauthorized
                    body: JSON.stringify({ message: 'Invalid credentials.' }),
                };
            }

            // 3. Generate a JWT
            const token = jwt.sign(
                {
                    userId: user.id,
                    username: user.username,
                    role: user.role,
                    companyId: user.company_id
                },
                process.env.JWT_SECRET, // Your secret key from Netlify environment variables
                { expiresIn: '1h' } // Token expires in 1 hour
            );

            return {
                statusCode: 200, // OK
                body: JSON.stringify({
                    message: 'Login successful!',
                    token: token,
                    user: {
                        id: user.id,
                        username: user.username,
                        email: user.email,
                        role: user.role,
                        companyId: user.company_id
                    }
                }),
            };

        } catch (dbError) {
            console.error('Database query error:', dbError);
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
