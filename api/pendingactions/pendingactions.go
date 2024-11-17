package pendingactions

import (
	"context"
	"fmt"
	"sync"

	portainer "github.com/portainer/portainer/api"
	"github.com/portainer/portainer/api/dataservices"
	"github.com/portainer/portainer/api/datastore/postinit"
	dockerClient "github.com/portainer/portainer/api/docker/client"
	"github.com/portainer/portainer/api/internal/authorization"
	"github.com/portainer/portainer/api/internal/endpointutils"
	kubecli "github.com/portainer/portainer/api/kubernetes/cli"
	"github.com/portainer/portainer/api/pendingactions/actions"
	"github.com/rs/zerolog/log"
)

type (
	PendingActionsService struct {
		authorizationService *authorization.Service
		kubeFactory          *kubecli.ClientFactory
		dockerFactory        *dockerClient.ClientFactory
		dataStore            dataservices.DataStore
		shutdownCtx          context.Context
		assetsPath           string
		kubernetesDeployer   portainer.KubernetesDeployer

		mu sync.Mutex
	}
)

func NewService(
	dataStore dataservices.DataStore,
	kubeFactory *kubecli.ClientFactory,
	dockerFactory *dockerClient.ClientFactory,
	authorizationService *authorization.Service,
	shutdownCtx context.Context,
	assetsPath string,
	kubernetesDeployer portainer.KubernetesDeployer,
) *PendingActionsService {
	return &PendingActionsService{
		dataStore:            dataStore,
		shutdownCtx:          shutdownCtx,
		authorizationService: authorizationService,
		kubeFactory:          kubeFactory,
		dockerFactory:        dockerFactory,
		assetsPath:           assetsPath,
		kubernetesDeployer:   kubernetesDeployer,
		mu:                   sync.Mutex{},
	}
}

func (service *PendingActionsService) Create(r portainer.PendingActions) error {
	return service.dataStore.PendingActions().Create(&r)
}

func (service *PendingActionsService) Execute(id portainer.EndpointID) {
	// Run in a goroutine to avoid blocking the main thread due to db tx	=
	go service.execute(id)
}

func (service *PendingActionsService) execute(environmentID portainer.EndpointID) {
	service.mu.Lock()
	defer service.mu.Unlock()

	endpoint, err := service.dataStore.Endpoint().Endpoint(environmentID)
	if err != nil {
		log.Debug().Msgf("failed to retrieve environment %d: %v", environmentID, err)
		return
	}

	isKubernetesEndpoint := endpointutils.IsKubernetesEndpoint(endpoint) && !endpointutils.IsEdgeEndpoint(endpoint)

	// EndpointStatusUp is only relevant for non-Kubernetes endpoints
	// Sometimes the endpoint is UP but the status is not updated in the database
	if !isKubernetesEndpoint && endpoint.Status != portainer.EndpointStatusUp {
		log.Debug().Msgf("failed to create Kubernetes client for environment %d: %v", environmentID, err)
		return
	}

	// For Kubernetes endpoints, we need to check if the endpoint is up by creating a kube client
	if isKubernetesEndpoint {
		if client, _ := service.kubeFactory.GetKubeClient(endpoint); client != nil {
			if _, err = client.ServerVersion(); err != nil {
				log.Debug().Err(err).Msgf("Environment %q (id: %d) is not up", endpoint.Name, environmentID)
				return
			}
		}
	}

	pendingActions, err := service.dataStore.PendingActions().ReadAll()
	if err != nil {
		log.Error().Err(err).Msgf("failed to retrieve pending actions")
		return
	}

	if len(pendingActions) > 0 {
		log.Debug().Msgf("Found %d pending actions", len(pendingActions))
	}

	for i, endpointPendingAction := range pendingActions {
		if endpointPendingAction.EndpointID == environmentID {
			if i == 0 {
				// We have at least 1 pending action for this environment
				log.Debug().Msgf("Executing pending actions for environment %d", environmentID)
			}

			err := service.executePendingAction(endpointPendingAction, endpoint)
			if err != nil {
				log.Warn().Err(err).Msgf("failed to execute pending action")
				continue
			}

			err = service.dataStore.PendingActions().Delete(endpointPendingAction.ID)
			if err != nil {
				log.Error().Err(err).Msgf("failed to delete pending action")
				continue
			}
		}
	}
}

func (service *PendingActionsService) executePendingAction(pendingAction portainer.PendingActions, endpoint *portainer.Endpoint) error {
	log.Debug().Msgf("Executing pending action %s for environment %d", pendingAction.Action, pendingAction.EndpointID)

	defer func() {
		log.Debug().Msgf("End executing pending action %s for environment %d", pendingAction.Action, pendingAction.EndpointID)
	}()

	switch pendingAction.Action {
	case actions.CleanNAPWithOverridePolicies:
		pendingActionData, err := actions.ConvertCleanNAPWithOverridePoliciesPayload(pendingAction.ActionData)
		if err != nil {
			return fmt.Errorf("failed to parse pendingActionData for CleanNAPWithOverridePoliciesPayload")
		}

		if pendingActionData == nil || pendingActionData.EndpointGroupID == 0 {
			service.authorizationService.CleanNAPWithOverridePolicies(service.dataStore, endpoint, nil)
			return nil
		}

		endpointGroupID := pendingActionData.EndpointGroupID

		endpointGroup, err := service.dataStore.EndpointGroup().Read(portainer.EndpointGroupID(endpointGroupID))
		if err != nil {
			log.Error().Err(err).Msgf("Error reading environment group to clean NAP with override policies for environment %d and environment group %d", endpoint.ID, endpointGroup.ID)
			return fmt.Errorf("failed to retrieve environment group %d: %w", endpointGroupID, err)
		}
		err = service.authorizationService.CleanNAPWithOverridePolicies(service.dataStore, endpoint, endpointGroup)
		if err != nil {
			log.Error().Err(err).Msgf("Error cleaning NAP with override policies for environment %d and environment group %d", endpoint.ID, endpointGroup.ID)
			return fmt.Errorf("failed to clean NAP with override policies for environment %d and environment group %d: %w", endpoint.ID, endpointGroup.ID, err)
		}

		return nil
	case actions.DeletePortainerK8sRegistrySecrets:
		if pendingAction.ActionData == nil {
			return nil
		}

		registryData, err := convertToDeletePortainerK8sRegistrySecretsData(pendingAction.ActionData)
		if err != nil {
			return fmt.Errorf("failed to parse pendingActionData: %w", err)
		}

		err = service.DeleteKubernetesRegistrySecrets(endpoint, registryData)
		if err != nil {
			log.Warn().Err(err).Int("endpoint_id", int(endpoint.ID)).Msgf("Unable to delete kubernetes registry secrets")
			return fmt.Errorf("failed to delete kubernetes registry secrets for environment %d: %w", endpoint.ID, err)
		}

		return nil

	case actions.PostInitMigrateEnvironment:
		postInitMigrator := postinit.NewPostInitMigrator(
			service.kubeFactory,
			service.dockerFactory,
			service.dataStore,
			service.assetsPath,
			service.kubernetesDeployer,
		)
		err := postInitMigrator.MigrateEnvironment(endpoint)
		if err != nil {
			log.Error().Err(err).Msgf("Error running post-init migrations for edge environment %d", endpoint.ID)
			return fmt.Errorf("failed running post-init migrations for edge environment %d: %w", endpoint.ID, err)
		}

		return nil
	}

	return nil
}