// functions/register.js

const { Client } = require('pg');
const bcrypt = require('bcryptjs'); // For password hashing

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
        const { username, email, password, companyName, companyCity, companyState } = JSON.parse(event.body);

        if (!username || !email || !password || !companyName) {
            return {
                statusCode: 400,
                body: JSON.stringify({ message: 'Missing required fields.' }),
            };
        }

        const client = await createDbClient();

        try {
            // Start a transaction for atomicity
            await client.query('BEGIN');

            // 1. Check if username or email already exists
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

            // 2. Find or create company
            let companyId;
            const companyResult = await client.query(
                'SELECT id FROM companies WHERE name = $1',
                [companyName]
            );

            if (companyResult.rows.length > 0) {
                companyId = companyResult.rows[0].id;
            } else {
                // Company does not exist, create new one
                if (!companyCity || !companyState) {
                    await client.query('ROLLBACK');
                    return {
                        statusCode: 400,
                        body: JSON.stringify({ message: 'Company city and state are required for new companies.' }),
                    };
                }
                const newCompanyResult = await client.query(
                    'INSERT INTO companies(name, city, state) VALUES($1, $2, $3) RETURNING id',
                    [companyName, companyCity, companyState]
                );
                companyId = newCompanyResult.rows[0].id;
            }

            // 3. Hash password
            const salt = await bcrypt.genSalt(10); // Generate a salt
            const passwordHash = await bcrypt.hash(password, salt); // Hash the password

            // 4. Insert new user
            const insertUserQuery = `
                INSERT INTO users(username, email, password_hash, company_id, role)
                VALUES($1, $2, $3, $4, $5) RETURNING id, username, email, role;
            `;
            const newUserResult = await client.query(
                insertUserQuery,
                [username, email, passwordHash, companyId, 'standard'] // Default role is 'standard'
            );

            await client.query('COMMIT'); // Commit the transaction

            const newUser = newUserResult.rows[0];

            return {
                statusCode: 201, // Created
                body: JSON.stringify({
                    message: 'User registered successfully!',
                    user: {
                        id: newUser.id,
                        username: newUser.username,
                        email: newUser.email,
                        role: newUser.role
                    }
                }),
            };

        } catch (dbError) {
            await client.query('ROLLBACK'); // Rollback on error
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
