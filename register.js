const registrationForm = document.getElementById('registrationForm');
        const messageDiv = document.getElementById('message');

        registrationForm.addEventListener('submit', async (event) => {
            event.preventDefault(); // Prevent default form submission

            const username = document.getElementById('username').value;
            const email = document.getElementById('email').value;
            const password = document.getElementById('password').value;
            const companyName = document.getElementById('companyName').value;
            const companyCity = document.getElementById('companyCity').value;
            const companyState = document.getElementById('companyState').value;

            // The endpoint for your Netlify Function
            const API_ENDPOINT = '/.netlify/functions/register'; // Relative path works automatically on Netlify

            try {
                const response = await fetch(API_ENDPOINT, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        username,
                        email,
                        password,
                        companyName,
                        companyCity,
                        companyState
                    }),
                });

                const data = await response.json(); // Parse the JSON response

                if (response.ok) { // Check if the response status is 2xx
                    messageDiv.className = 'success';
                    messageDiv.textContent = data.message || 'Registration successful!';
                    registrationForm.reset(); // Clear the form
                    console.log('User registered:', data.user);
                    // Optionally, redirect to login page or show login form
                } else {
                    messageDiv.className = 'error';
                    messageDiv.textContent = data.message || 'Registration failed. Please try again.';
                    console.error('Registration error:', data.error);
                }
            } catch (error) {
                messageDiv.className = 'error';
                messageDiv.textContent = 'Network error or server unreachable.';
                console.error('Fetch error:', error);
            }
        });
