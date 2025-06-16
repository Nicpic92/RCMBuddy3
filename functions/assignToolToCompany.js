// functions/assignToolToCompany.js

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

    // 1. Authenticate the request
    const authResult = authHelper.verifyToken(event);
    if (authResult.statusCode !== 200) {
        return authResult; // Return authentication error if token is missing/invalid
    }
    const requestingUser = authResult.user;

    // 2. Authorize the user: Must be a superadmin
    if (!authHelper.hasRole(requestingUser, 'superadmin')) {
        return {
            statusCode: 403, // Forbidden
            body: JSON.stringify({ message: 'Access denied. Superadmin role required.' }),
        };
    }

    try {
        const { companyId, toolId } = JSON.parse(event.body);

        if (!companyId || !toolId) {
            return {
                statusCode: 400,
                body: JSON.stringify({ message: 'Missing companyId or toolId.' }),
            };
        }

        const client = await createDbClient();

        try {
            await client.query('BEGIN'); // Start a transaction

            // 3. Validate if company exists
            const companyExists = await client.query('SELECT 1 FROM companies WHERE id = $1', [companyId]);
            if (companyExists.rows.length === 0) {
                await client.query('ROLLBACK');
                return {
                    statusCode: 404,
                    body: JSON.stringify({ message: 'Company not found.' }),
                };
            }

            // 4. Validate if tool exists (and is not a global tool, as global tools don't need company-specific assignment)
            const toolResult = await client.query('SELECT is_global FROM tools WHERE id = $1', [toolId]);
            if (toolResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return {
                    statusCode: 404,
                    body: JSON.stringify({ message: 'Tool not found.' }),
                };
            }
            if (toolResult.rows[0].is_global) {
                await client.query('ROLLBACK');
                return {
                    statusCode: 400,
                    body: JSON.stringify({ message: 'Global tools do not need to be assigned to companies explicitly.' }),
                };
            }

            // 5. Check if the tool is already assigned to this company
            const existingAssignment = await client.query(
                'SELECT 1 FROM company_tools WHERE company_id = $1 AND tool_id = $2',
                [companyId, toolId]
            );
            if (existingAssignment.rows.length > 0) {
                await client.query('ROLLBACK');
                return {
                    statusCode: 409, // Conflict
                    body: JSON.stringify({ message: 'Tool is already assigned to this company.' }),
                };
            }

            // 6. Assign the tool to the company
            await client.query(
                'INSERT INTO company_tools(company_id, tool_id) VALUES($1, $2)',
                [companyId, toolId]
            );

            await client.query('COMMIT'); // Commit the transaction

            return {
                statusCode: 200,
                body: JSON.stringify({ message: `Tool ${toolId} successfully assigned to company ${companyId}.` }),
            };

        } catch (dbError) {
            await client.query('ROLLBACK'); // Rollback on error
            console.error('Database transaction error (assignToolToCompany):', dbError);
            return {
                statusCode: 500,
                body: JSON.stringify({ message: 'Database operation failed.', error: dbError.message }),
            };
        } finally {
            await client.end(); // Close the client connection
        }

    } catch (parseError) {
        console.error('JSON Parse Error (assignToolToCompany):', parseError);
        return {
            statusCode: 400,
            body: JSON.stringify({ message: 'Invalid JSON body.' }),
        };
    } catch (generalError) {
        console.error('General Error (assignToolToCompany):', generalError);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'An unexpected error occurred.', error: generalError.message }),
        };
    }
};
