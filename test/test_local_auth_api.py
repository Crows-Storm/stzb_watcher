import unittest

import api_server


class LocalAuthRemovedTest(unittest.TestCase):
    def test_index_opens_console_without_login_gate(self):
        html = api_server.app.test_client().get("/").get_data(as_text=True)
        self.assertIn("率土战场指挥台", html)
        self.assertNotIn("local-auth-gate", html)
        self.assertNotIn("local-auth.js", html)
        self.assertNotIn('id="local-auth-form"', html)

    def test_auth_proxy_routes_are_removed(self):
        client = api_server.app.test_client()
        for path in (
            "/api/local-auth/login",
            "/api/local-auth/register",
            "/api/local-auth/verify",
        ):
            response = client.post(path, json={"username": "alice", "password": "secret", "token": "opaque-token"})
            self.assertEqual(404, response.status_code, path)


if __name__ == "__main__":
    unittest.main()
