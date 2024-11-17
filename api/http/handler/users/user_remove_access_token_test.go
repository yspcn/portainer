package users

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	portainer "github.com/portainer/portainer/api"
	"github.com/portainer/portainer/api/apikey"
	"github.com/portainer/portainer/api/datastore"
	"github.com/portainer/portainer/api/http/security"
	"github.com/portainer/portainer/api/internal/testhelpers"
	"github.com/portainer/portainer/api/jwt"
	"github.com/stretchr/testify/assert"
)

func Test_userRemoveAccessToken(t *testing.T) {
	is := assert.New(t)

	_, store := datastore.MustNewTestStore(t, true, true)

	// create admin and standard user(s)
	adminUser := &portainer.User{ID: 1, Username: "admin", Role: portainer.AdministratorRole}
	err := store.User().Create(adminUser)
	is.NoError(err, "error creating admin user")

	user := &portainer.User{ID: 2, Username: "standard", Role: portainer.StandardUserRole}
	err = store.User().Create(user)
	is.NoError(err, "error creating user")

	// setup services
	jwtService, err := jwt.NewService("1h", store)
	is.NoError(err, "Error initiating jwt service")
	apiKeyService := apikey.NewAPIKeyService(store.APIKeyRepository(), store.User())
	requestBouncer := security.NewRequestBouncer(store, jwtService, apiKeyService)
	rateLimiter := security.NewRateLimiter(10, 1*time.Second, 1*time.Hour)
	passwordChecker := security.NewPasswordStrengthChecker(store.SettingsService)

	h := NewHandler(requestBouncer, rateLimiter, apiKeyService, nil, passwordChecker)
	h.DataStore = store

	// generate standard and admin user tokens
	adminJWT, _, _ := jwtService.GenerateToken(&portainer.TokenData{ID: adminUser.ID, Username: adminUser.Username, Role: adminUser.Role})
	jwt, _, _ := jwtService.GenerateToken(&portainer.TokenData{ID: user.ID, Username: user.Username, Role: user.Role})

	t.Run("standard user can successfully delete API key", func(t *testing.T) {
		is := assert.New(t)
		_, apiKey, err := apiKeyService.GenerateApiKey(*user, "test-delete-token")
		is.NoError(err)

		req := httptest.NewRequest(http.MethodDelete, fmt.Sprintf("%s/%d", "/users/2/tokens", apiKey.ID), nil)
		testhelpers.AddTestSecurityCookie(req, jwt)

		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, req)

		is.Equal(http.StatusNoContent, rr.Code)

		keys, err := apiKeyService.GetAPIKeys(user.ID)
		is.NoError(err)

		is.Equal(0, len(keys))
	})

	t.Run("admin can delete a standard user API Key", func(t *testing.T) {
		is := assert.New(t)
		_, apiKey, err := apiKeyService.GenerateApiKey(*user, "test-admin-delete-token")
		is.NoError(err)

		req := httptest.NewRequest(http.MethodDelete, fmt.Sprintf("%s/%d", "/users/2/tokens", apiKey.ID), nil)
		testhelpers.AddTestSecurityCookie(req, adminJWT)

		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, req)

		is.Equal(http.StatusNoContent, rr.Code)

		keys, err := apiKeyService.GetAPIKeys(user.ID)
		is.NoError(err)

		is.Equal(0, len(keys))
	})

	t.Run("user can delete API Key using api-key auth", func(t *testing.T) {
		is := assert.New(t)
		rawAPIKey, apiKey, err := apiKeyService.GenerateApiKey(*user, "test-api-key-auth-deletion")
		is.NoError(err)

		req := httptest.NewRequest(http.MethodDelete, fmt.Sprintf("%s/%d", "/users/2/tokens", apiKey.ID), nil)
		req.Header.Add("x-api-key", rawAPIKey)

		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, req)

		is.Equal(http.StatusNoContent, rr.Code)

		keys, err := apiKeyService.GetAPIKeys(user.ID)
		is.NoError(err)

		is.Equal(0, len(keys))
	})

	t.Run("user cannot delete another users API Keys using api-key auth", func(t *testing.T) {
		_, adminAPIKey, err := apiKeyService.GenerateApiKey(*adminUser, "admin-key")
		is.NoError(err)

		rawAPIKey, _, err := apiKeyService.GenerateApiKey(*user, "user-key")
		is.NoError(err)

		req := httptest.NewRequest(http.MethodDelete, fmt.Sprintf("/users/%d/tokens/%d", user.ID, adminAPIKey.ID), nil)
		req.Header.Add("x-api-key", rawAPIKey)

		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, req)

		is.Equal(http.StatusForbidden, rr.Code)

		adminKeyGot, err := apiKeyService.GetAPIKey(adminAPIKey.ID)
		is.NoError(err)

		is.Equal(adminAPIKey, adminKeyGot)
	})
}