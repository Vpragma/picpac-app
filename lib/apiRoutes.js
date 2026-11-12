// Создано scripts/gen-api-routes.mjs — не править руками.
export const API_ROUTES = [
  {
    "pattern": "^/api/v1/admin/audit/?$",
    "methods": [
      "GET"
    ]
  },
  {
    "pattern": "^/api/v1/auth/login/?$",
    "methods": [
      "POST"
    ]
  },
  {
    "pattern": "^/api/v1/auth/logout/?$",
    "methods": [
      "POST"
    ]
  },
  {
    "pattern": "^/api/v1/auth/mfa/enroll/?$",
    "methods": [
      "POST"
    ]
  },
  {
    "pattern": "^/api/v1/auth/mfa/verify/?$",
    "methods": [
      "POST"
    ]
  },
  {
    "pattern": "^/api/v1/auth/register/?$",
    "methods": [
      "POST"
    ]
  },
  {
    "pattern": "^/api/v1/auth/role/?$",
    "methods": [
      "POST"
    ]
  },
  {
    "pattern": "^/api/v1/cart/?$",
    "methods": [
      "GET",
      "PUT"
    ]
  },
  {
    "pattern": "^/api/v1/cart/merge/?$",
    "methods": [
      "POST"
    ]
  },
  {
    "pattern": "^/api/v1/catalog/?$",
    "methods": [
      "GET"
    ]
  },
  {
    "pattern": "^/api/v1/checks/ack/?$",
    "methods": [
      "POST"
    ]
  },
  {
    "pattern": "^/api/v1/interactions/[^/]+/messages/?$",
    "methods": [
      "GET",
      "POST"
    ]
  },
  {
    "pattern": "^/api/v1/me/?$",
    "methods": [
      "GET",
      "PATCH",
      "DELETE"
    ]
  },
  {
    "pattern": "^/api/v1/me/export/?$",
    "methods": [
      "GET"
    ]
  },
  {
    "pattern": "^/api/v1/me/photos/?$",
    "methods": [
      "DELETE"
    ]
  },
  {
    "pattern": "^/api/v1/orders/?$",
    "methods": [
      "GET",
      "POST"
    ]
  },
  {
    "pattern": "^/api/v1/orders/[^/]+/?$",
    "methods": [
      "GET"
    ]
  },
  {
    "pattern": "^/api/v1/orders/[^/]+/interactions/?$",
    "methods": [
      "POST"
    ]
  },
  {
    "pattern": "^/api/v1/orders/[^/]+/pay-test/?$",
    "methods": [
      "POST"
    ]
  },
  {
    "pattern": "^/api/v1/photos/[^/]+/url/?$",
    "methods": [
      "GET"
    ]
  },
  {
    "pattern": "^/api/v1/projects/?$",
    "methods": [
      "GET",
      "POST"
    ]
  },
  {
    "pattern": "^/api/v1/projects/[^/]+/?$",
    "methods": [
      "GET",
      "PATCH",
      "DELETE"
    ]
  },
  {
    "pattern": "^/api/v1/projects/[^/]+/photos/?$",
    "methods": [
      "POST"
    ]
  },
  {
    "pattern": "^/api/v1/projects/[^/]+/photos/[^/]+/?$",
    "methods": [
      "DELETE"
    ]
  },
  {
    "pattern": "^/api/v1/projects/[^/]+/photos/[^/]+/print/?$",
    "methods": [
      "POST",
      "PUT"
    ]
  },
  {
    "pattern": "^/api/v1/projects/[^/]+/photos/order/?$",
    "methods": [
      "PATCH"
    ]
  },
  {
    "pattern": "^/api/v1/projects/[^/]+/photos/upload-url/?$",
    "methods": [
      "POST"
    ]
  },
  {
    "pattern": "^/api/v1/promo/validate/?$",
    "methods": [
      "POST"
    ]
  }
];
