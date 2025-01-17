import _ from 'lodash-es';
import { PorImageRegistryModel } from 'Docker/models/porImageRegistry';
import { ContainerCapabilities, ContainerCapability } from '../../../models/containerCapabilities';
import { AccessControlFormData } from '../../../../portainer/components/accessControlForm/porAccessControlFormModel';
import { ContainerDetailsViewModel } from '../../../models/container';

angular.module('portainer.docker').controller('CreateContainerController', [
  '$q',
  '$scope',
  '$async',
  '$state',
  '$timeout',
  '$transition$',
  '$filter',
  'Container',
  'ContainerHelper',
  'Image',
  'ImageHelper',
  'Volume',
  'NetworkService',
  'ResourceControlService',
  'Authentication',
  'Notifications',
  'ContainerService',
  'ImageService',
  'FormValidator',
  'ModalService',
  'RegistryService',
  'SystemService',
  'SettingsService',
  'PluginService',
  'HttpRequestHelper',
  'ExtensionService',
  function (
    $q,
    $scope,
    $async,
    $state,
    $timeout,
    $transition$,
    $filter,
    Container,
    ContainerHelper,
    Image,
    ImageHelper,
    Volume,
    NetworkService,
    ResourceControlService,
    Authentication,
    Notifications,
    ContainerService,
    ImageService,
    FormValidator,
    ModalService,
    RegistryService,
    SystemService,
    SettingsService,
    PluginService,
    HttpRequestHelper,
    ExtensionService
  ) {
    $scope.create = create;

    $scope.formValues = {
      alwaysPull: true,
      Console: 'none',
      Volumes: [],
      NetworkContainer: '',
      Labels: [],
      ExtraHosts: [],
      MacAddress: '',
      IPv4: '',
      IPv6: '',
      DnsPrimary: '',
      DnsSecondary: '',
      AccessControlData: new AccessControlFormData(),
      CpuLimit: 0,
      MemoryLimit: 0,
      MemoryReservation: 0,
      NodeName: null,
      capabilities: [],
      LogDriverName: '',
      LogDriverOpts: [],
      RegistryModel: new PorImageRegistryModel(),
    };

    $scope.extraNetworks = {};

    $scope.state = {
      formValidationError: '',
      actionInProgress: false,
    };

    $scope.refreshSlider = function () {
      $timeout(function () {
        $scope.$broadcast('rzSliderForceRender');
      });
    };

    $scope.config = {
      Image: '',
      Env: [],
      Cmd: '',
      MacAddress: '',
      ExposedPorts: {},
      HostConfig: {
        RestartPolicy: {
          Name: 'no',
        },
        PortBindings: [],
        PublishAllPorts: false,
        Binds: [],
        AutoRemove: false,
        NetworkMode: 'bridge',
        Privileged: false,
        Init: false,
        Runtime: '',
        ExtraHosts: [],
        Devices: [],
        CapAdd: [],
        CapDrop: [],
      },
      NetworkingConfig: {
        EndpointsConfig: {},
      },
      Labels: {},
    };

    $scope.addVolume = function () {
      $scope.formValues.Volumes.push({ name: '', containerPath: '', readOnly: false, type: 'volume' });
    };

    $scope.removeVolume = function (index) {
      $scope.formValues.Volumes.splice(index, 1);
    };

    $scope.addEnvironmentVariable = function () {
      $scope.config.Env.push({ name: '', value: '' });
    };

    $scope.removeEnvironmentVariable = function (index) {
      $scope.config.Env.splice(index, 1);
    };

    $scope.addPortBinding = function () {
      $scope.config.HostConfig.PortBindings.push({ hostPort: '', containerPort: '', protocol: 'tcp' });
    };

    $scope.removePortBinding = function (index) {
      $scope.config.HostConfig.PortBindings.splice(index, 1);
    };

    $scope.addLabel = function () {
      $scope.formValues.Labels.push({ name: '', value: '' });
    };

    $scope.removeLabel = function (index) {
      $scope.formValues.Labels.splice(index, 1);
    };

    $scope.addExtraHost = function () {
      $scope.formValues.ExtraHosts.push({ value: '' });
    };

    $scope.removeExtraHost = function (index) {
      $scope.formValues.ExtraHosts.splice(index, 1);
    };

    $scope.addDevice = function () {
      $scope.config.HostConfig.Devices.push({ pathOnHost: '', pathInContainer: '' });
    };

    $scope.removeDevice = function (index) {
      $scope.config.HostConfig.Devices.splice(index, 1);
    };

    $scope.addLogDriverOpt = function () {
      $scope.formValues.LogDriverOpts.push({ name: '', value: '' });
    };

    $scope.removeLogDriverOpt = function (index) {
      $scope.formValues.LogDriverOpts.splice(index, 1);
    };

    $scope.fromContainerMultipleNetworks = false;

    function prepareImageConfig(config) {
      const imageConfig = ImageHelper.createImageConfigForContainer($scope.formValues.RegistryModel);
      config.Image = imageConfig.fromImage;
    }

    function preparePortBindings(config) {
      const bindings = ContainerHelper.preparePortBindings(config.HostConfig.PortBindings);
      _.forEach(bindings, (_, key) => (config.ExposedPorts[key] = {}));
      config.HostConfig.PortBindings = bindings;
    }

    function prepareConsole(config) {
      var value = $scope.formValues.Console;
      var openStdin = true;
      var tty = true;
      if (value === 'tty') {
        openStdin = false;
      } else if (value === 'interactive') {
        tty = false;
      } else if (value === 'none') {
        openStdin = false;
        tty = false;
      }
      config.OpenStdin = openStdin;
      config.Tty = tty;
    }

    function prepareEnvironmentVariables(config) {
      var env = [];
      config.Env.forEach(function (v) {
        if (v.name && v.value) {
          env.push(v.name + '=' + v.value);
        }
      });
      config.Env = env;
    }

    function prepareVolumes(config) {
      var binds = [];
      var volumes = {};

      $scope.formValues.Volumes.forEach(function (volume) {
        var name = volume.name;
        var containerPath = volume.containerPath;
        if (name && containerPath) {
          var bind = name + ':' + containerPath;
          volumes[containerPath] = {};
          if (volume.readOnly) {
            bind += ':ro';
          }
          binds.push(bind);
        }
      });
      config.HostConfig.Binds = binds;
      config.Volumes = volumes;
    }

    function prepareNetworkConfig(config) {
      var mode = config.HostConfig.NetworkMode;
      var container = $scope.formValues.NetworkContainer;
      var containerName = container;
      if (container && typeof container === 'object') {
        containerName = $filter('trimcontainername')(container.Names[0]);
      }
      var networkMode = mode;
      if (containerName) {
        networkMode += ':' + containerName;
        config.Hostname = '';
      }
      config.HostConfig.NetworkMode = networkMode;
      config.MacAddress = $scope.formValues.MacAddress;

      config.NetworkingConfig.EndpointsConfig[networkMode] = {
        IPAMConfig: {
          IPv4Address: $scope.formValues.IPv4,
          IPv6Address: $scope.formValues.IPv6,
        },
      };

      if (networkMode && _.get($scope.config.NetworkingConfig.EndpointsConfig[networkMode], 'Aliases')) {
        var aliases = $scope.config.NetworkingConfig.EndpointsConfig[networkMode].Aliases;
        config.NetworkingConfig.EndpointsConfig[networkMode].Aliases = _.filter(aliases, (o) => {
          return !_.startsWith($scope.fromContainer.Id, o);
        });
      }

      var dnsServers = [];
      if ($scope.formValues.DnsPrimary) {
        dnsServers.push($scope.formValues.DnsPrimary);
      }
      if ($scope.formValues.DnsSecondary) {
        dnsServers.push($scope.formValues.DnsSecondary);
      }
      config.HostConfig.Dns = dnsServers;

      $scope.formValues.ExtraHosts.forEach(function (v) {
        if (v.value) {
          config.HostConfig.ExtraHosts.push(v.value);
        }
      });
    }

    function prepareLabels(config) {
      var labels = {};
      $scope.formValues.Labels.forEach(function (label) {
        if (label.name) {
          if (label.value) {
            labels[label.name] = label.value;
          } else {
            labels[label.name] = '';
          }
        }
      });
      config.Labels = labels;
    }

    function prepareDevices(config) {
      var path = [];
      config.HostConfig.Devices.forEach(function (p) {
        if (p.pathOnHost) {
          if (p.pathInContainer === '') {
            p.pathInContainer = p.pathOnHost;
          }
          path.push({ PathOnHost: p.pathOnHost, PathInContainer: p.pathInContainer, CgroupPermissions: 'rwm' });
        }
      });
      config.HostConfig.Devices = path;
    }

    function prepareResources(config) {
      // Memory Limit - Round to 0.125
      var memoryLimit = (Math.round($scope.formValues.MemoryLimit * 8) / 8).toFixed(3);
      memoryLimit *= 1024 * 1024;
      if (memoryLimit > 0) {
        config.HostConfig.Memory = memoryLimit;
      }
      // Memory Resevation - Round to 0.125
      var memoryReservation = (Math.round($scope.formValues.MemoryReservation * 8) / 8).toFixed(3);
      memoryReservation *= 1024 * 1024;
      if (memoryReservation > 0) {
        config.HostConfig.MemoryReservation = memoryReservation;
      }
      // CPU Limit
      if ($scope.formValues.CpuLimit > 0) {
        config.HostConfig.NanoCpus = $scope.formValues.CpuLimit * 1000000000;
      }
    }

    function prepareLogDriver(config) {
      var logOpts = {};
      if ($scope.formValues.LogDriverName) {
        config.HostConfig.LogConfig = { Type: $scope.formValues.LogDriverName };
        if ($scope.formValues.LogDriverName !== 'none') {
          $scope.formValues.LogDriverOpts.forEach(function (opt) {
            if (opt.name) {
              logOpts[opt.name] = opt.value;
            }
          });
          if (Object.keys(logOpts).length !== 0 && logOpts.constructor === Object) {
            config.HostConfig.LogConfig.Config = logOpts;
          }
        }
      }
    }

    function prepareCapabilities(config) {
      var allowed = $scope.formValues.capabilities.filter(function (item) {
        return item.allowed === true;
      });
      var notAllowed = $scope.formValues.capabilities.filter(function (item) {
        return item.allowed === false;
      });

      var getCapName = function (item) {
        return item.capability;
      };
      config.HostConfig.CapAdd = allowed.map(getCapName);
      config.HostConfig.CapDrop = notAllowed.map(getCapName);
    }

    function prepareConfiguration() {
      var config = angular.copy($scope.config);
      config.Cmd = ContainerHelper.commandStringToArray(config.Cmd);
      prepareNetworkConfig(config);
      prepareImageConfig(config);
      preparePortBindings(config);
      prepareConsole(config);
      prepareEnvironmentVariables(config);
      prepareVolumes(config);
      prepareLabels(config);
      prepareDevices(config);
      prepareResources(config);
      prepareLogDriver(config);
      prepareCapabilities(config);
      return config;
    }

    function loadFromContainerCmd() {
      if ($scope.config.Cmd) {
        $scope.config.Cmd = ContainerHelper.commandArrayToString($scope.config.Cmd);
      } else {
        $scope.config.Cmd = '';
      }
    }

    function loadFromContainerPortBindings() {
      const bindings = ContainerHelper.sortAndCombinePorts($scope.config.HostConfig.PortBindings);
      $scope.config.HostConfig.PortBindings = bindings;
    }

    function loadFromContainerVolumes(d) {
      for (var v in d.Mounts) {
        if ({}.hasOwnProperty.call(d.Mounts, v)) {
          var mount = d.Mounts[v];
          var volume = {
            type: mount.Type,
            name: mount.Name || mount.Source,
            containerPath: mount.Destination,
            readOnly: mount.RW === false,
          };
          $scope.formValues.Volumes.push(volume);
        }
      }
    }

    $scope.resetNetworkConfig = function () {
      $scope.config.NetworkingConfig = {
        EndpointsConfig: {},
      };
    };

    function loadFromContainerNetworkConfig(d) {
      $scope.config.NetworkingConfig = {
        EndpointsConfig: {},
      };
      var networkMode = d.HostConfig.NetworkMode;
      if (networkMode === 'default') {
        $scope.config.HostConfig.NetworkMode = 'bridge';
        if (!_.find($scope.availableNetworks, { Name: 'bridge' })) {
          $scope.config.HostConfig.NetworkMode = 'nat';
        }
      }
      if ($scope.config.HostConfig.NetworkMode.indexOf('container:') === 0) {
        var netContainer = $scope.config.HostConfig.NetworkMode.split(/^container:/)[1];
        $scope.config.HostConfig.NetworkMode = 'container';
        for (var c in $scope.runningContainers) {
          if ($scope.runningContainers[c].Id == netContainer) {
            $scope.formValues.NetworkContainer = $scope.runningContainers[c];
          }
        }
      }
      $scope.fromContainerMultipleNetworks = Object.keys(d.NetworkSettings.Networks).length >= 2;
      if (d.NetworkSettings.Networks[$scope.config.HostConfig.NetworkMode]) {
        if (d.NetworkSettings.Networks[$scope.config.HostConfig.NetworkMode].IPAMConfig) {
          if (d.NetworkSettings.Networks[$scope.config.HostConfig.NetworkMode].IPAMConfig.IPv4Address) {
            $scope.formValues.IPv4 = d.NetworkSettings.Networks[$scope.config.HostConfig.NetworkMode].IPAMConfig.IPv4Address;
          }
          if (d.NetworkSettings.Networks[$scope.config.HostConfig.NetworkMode].IPAMConfig.IPv6Address) {
            $scope.formValues.IPv6 = d.NetworkSettings.Networks[$scope.config.HostConfig.NetworkMode].IPAMConfig.IPv6Address;
          }
        }
      }
      $scope.config.NetworkingConfig.EndpointsConfig[$scope.config.HostConfig.NetworkMode] = d.NetworkSettings.Networks[$scope.config.HostConfig.NetworkMode];
      if (Object.keys(d.NetworkSettings.Networks).length > 1) {
        var firstNetwork = d.NetworkSettings.Networks[Object.keys(d.NetworkSettings.Networks)[0]];
        $scope.config.NetworkingConfig.EndpointsConfig[$scope.config.HostConfig.NetworkMode] = firstNetwork;
        $scope.extraNetworks = angular.copy(d.NetworkSettings.Networks);
        delete $scope.extraNetworks[Object.keys(d.NetworkSettings.Networks)[0]];
      }
      $scope.formValues.MacAddress = d.Config.MacAddress;

      if (d.HostConfig.Dns && d.HostConfig.Dns[0]) {
        $scope.formValues.DnsPrimary = d.HostConfig.Dns[0];
        if (d.HostConfig.Dns[1]) {
          $scope.formValues.DnsSecondary = d.HostConfig.Dns[1];
        }
      }

      // ExtraHosts
      if ($scope.config.HostConfig.ExtraHosts) {
        var extraHosts = $scope.config.HostConfig.ExtraHosts;
        for (var i = 0; i < extraHosts.length; i++) {
          var host = extraHosts[i];
          $scope.formValues.ExtraHosts.push({ value: host });
        }
        $scope.config.HostConfig.ExtraHosts = [];
      }
    }

    function loadFromContainerEnvironmentVariables() {
      var envArr = [];
      for (var e in $scope.config.Env) {
        if ({}.hasOwnProperty.call($scope.config.Env, e)) {
          var arr = $scope.config.Env[e].split(/\=(.*)/);
          envArr.push({ name: arr[0], value: arr[1] });
        }
      }
      $scope.config.Env = envArr;
    }

    function loadFromContainerLabels() {
      for (var l in $scope.config.Labels) {
        if ({}.hasOwnProperty.call($scope.config.Labels, l)) {
          $scope.formValues.Labels.push({ name: l, value: $scope.config.Labels[l] });
        }
      }
    }

    function loadFromContainerConsole() {
      if ($scope.config.OpenStdin && $scope.config.Tty) {
        $scope.formValues.Console = 'both';
      } else if (!$scope.config.OpenStdin && $scope.config.Tty) {
        $scope.formValues.Console = 'tty';
      } else if ($scope.config.OpenStdin && !$scope.config.Tty) {
        $scope.formValues.Console = 'interactive';
      } else if (!$scope.config.OpenStdin && !$scope.config.Tty) {
        $scope.formValues.Console = 'none';
      }
    }

    function loadFromContainerDevices() {
      var path = [];
      for (var dev in $scope.config.HostConfig.Devices) {
        if ({}.hasOwnProperty.call($scope.config.HostConfig.Devices, dev)) {
          var device = $scope.config.HostConfig.Devices[dev];
          path.push({ pathOnHost: device.PathOnHost, pathInContainer: device.PathInContainer });
        }
      }
      $scope.config.HostConfig.Devices = path;
    }

    function loadFromContainerImageConfig() {
      RegistryService.retrievePorRegistryModelFromRepository($scope.config.Image)
        .then((model) => {
          $scope.formValues.RegistryModel = model;
        })
        .catch(function error(err) {
          Notifications.error('失败', err, '无法检索注册表');
        });
    }

    function loadFromContainerResources(d) {
      if (d.HostConfig.NanoCpus) {
        $scope.formValues.CpuLimit = d.HostConfig.NanoCpus / 1000000000;
      }
      if (d.HostConfig.Memory) {
        $scope.formValues.MemoryLimit = d.HostConfig.Memory / 1024 / 1024;
      }
      if (d.HostConfig.MemoryReservation) {
        $scope.formValues.MemoryReservation = d.HostConfig.MemoryReservation / 1024 / 1024;
      }
    }

    function loadFromContainerCapabilities(d) {
      if (d.HostConfig.CapAdd) {
        d.HostConfig.CapAdd.forEach(function (cap) {
          $scope.formValues.capabilities.push(new ContainerCapability(cap, true));
        });
      }
      if (d.HostConfig.CapDrop) {
        d.HostConfig.CapDrop.forEach(function (cap) {
          $scope.formValues.capabilities.push(new ContainerCapability(cap, false));
        });
      }

      function hasCapability(item) {
        return item.capability === cap.capability;
      }

      var capabilities = new ContainerCapabilities();
      for (var i = 0; i < capabilities.length; i++) {
        var cap = capabilities[i];
        if (!_.find($scope.formValues.capabilities, hasCapability)) {
          $scope.formValues.capabilities.push(cap);
        }
      }

      $scope.formValues.capabilities.sort(function (a, b) {
        return a.capability < b.capability ? -1 : 1;
      });
    }

    function loadFromContainerSpec() {
      // Get container
      Container.get({ id: $transition$.params().from })
        .$promise.then(function success(d) {
          var fromContainer = new ContainerDetailsViewModel(d);
          if (fromContainer.ResourceControl && fromContainer.ResourceControl.Public) {
            $scope.formValues.AccessControlData.AccessControlEnabled = false;
          }
          $scope.fromContainer = fromContainer;
          $scope.config = ContainerHelper.configFromContainer(fromContainer.Model);
          loadFromContainerCmd(d);
          loadFromContainerLogging(d);
          loadFromContainerPortBindings(d);
          loadFromContainerVolumes(d);
          loadFromContainerNetworkConfig(d);
          loadFromContainerEnvironmentVariables(d);
          loadFromContainerLabels(d);
          loadFromContainerConsole(d);
          loadFromContainerDevices(d);
          loadFromContainerImageConfig(d);
          loadFromContainerResources(d);
          loadFromContainerCapabilities(d);
        })
        .catch(function error(err) {
          Notifications.error('失败', err, '无法检索容器');
        });
    }

    function loadFromContainerLogging(config) {
      var logConfig = config.HostConfig.LogConfig;
      $scope.formValues.LogDriverName = logConfig.Type;
      $scope.formValues.LogDriverOpts = _.map(logConfig.Config, function (value, name) {
        return {
          name: name,
          value: value,
        };
      });
    }

    async function initView() {
      var nodeName = $transition$.params().nodeName;
      $scope.formValues.NodeName = nodeName;
      HttpRequestHelper.setPortainerAgentTargetHeader(nodeName);

      $scope.isAdmin = Authentication.isAdmin();
      $scope.isAdminOrEndpointAdmin = await checkIfAdminOrEndpointAdmin();
      $scope.showDeviceMapping = await shouldShowDevices($scope.isAdminOrEndpointAdmin);
      $scope.areContainerCapabilitiesEnabled = await checkIfContainerCapabilitiesEnabled($scope.isAdminOrEndpointAdmin);

      Volume.query(
        {},
        function (d) {
          $scope.availableVolumes = d.Volumes;
        },
        function (e) {
          Notifications.error('失败', e, '无法检索卷');
        }
      );

      var provider = $scope.applicationState.endpoint.mode.provider;
      var apiVersion = $scope.applicationState.endpoint.apiVersion;
      NetworkService.networks(provider === 'DOCKER_STANDALONE' || provider === 'DOCKER_SWARM_MODE', false, provider === 'DOCKER_SWARM_MODE' && apiVersion >= 1.25)
        .then(function success(data) {
          var networks = data;
          networks.push({ Name: 'container' });
          $scope.availableNetworks = networks;

          if (_.find(networks, { Name: 'nat' })) {
            $scope.config.HostConfig.NetworkMode = 'nat';
          }
        })
        .catch(function error(err) {
          Notifications.error('失败', err, '无法检索网络');
        });

      Container.query(
        {},
        function (d) {
          var containers = d;
          $scope.runningContainers = containers;
          if ($transition$.params().from) {
            loadFromContainerSpec();
          } else {
            $scope.fromContainer = {};
            $scope.formValues.capabilities = $scope.areContainerCapabilitiesEnabled ? new ContainerCapabilities() : [];
          }
        },
        function (e) {
          Notifications.error('失败', e, '无法检索正在运行的容器');
        }
      );

      SystemService.info()
        .then(function success(data) {
          $scope.availableRuntimes = data.Runtimes ? Object.keys(data.Runtimes) : [];
          $scope.config.HostConfig.Runtime = '';
          $scope.state.sliderMaxCpu = 32;
          if (data.NCPU) {
            $scope.state.sliderMaxCpu = data.NCPU;
          }
          $scope.state.sliderMaxMemory = 32768;
          if (data.MemTotal) {
            $scope.state.sliderMaxMemory = Math.floor(data.MemTotal / 1000 / 1000);
          }
        })
        .catch(function error(err) {
          Notifications.error('失败', err, '无法检索引擎详细信息');
        });

      SettingsService.publicSettings()
        .then(function success(data) {
          $scope.allowBindMounts = $scope.isAdminOrEndpointAdmin || data.AllowBindMountsForRegularUsers;
          $scope.allowPrivilegedMode = data.AllowPrivilegedModeForRegularUsers;
        })
        .catch(function error(err) {
          Notifications.error('失败', err, '无法检索应用程序设置');
        });

      PluginService.loggingPlugins(apiVersion < 1.25).then(function success(loggingDrivers) {
        $scope.availableLoggingDrivers = loggingDrivers;
      });
    }

    function validateForm(accessControlData, isAdmin) {
      $scope.state.formValidationError = '';
      var error = '';
      error = FormValidator.validateAccessControl(accessControlData, isAdmin);

      if (error) {
        $scope.state.formValidationError = error;
        return false;
      }
      return true;
    }

    function create() {
      var oldContainer = null;

      HttpRequestHelper.setPortainerAgentTargetHeader($scope.formValues.NodeName);
      return findCurrentContainer().then(setOldContainer).then(confirmCreateContainer).then(startCreationProcess).catch(notifyOnError).finally(final);

      function final() {
        $scope.state.actionInProgress = false;
      }

      function setOldContainer(container) {
        oldContainer = container;
        return container;
      }

      function findCurrentContainer() {
        return Container.query({ all: 1, filters: { name: ['^/' + $scope.config.name + '$'] } })
          .$promise.then(function onQuerySuccess(containers) {
            if (!containers.length) {
              return;
            }
            return containers[0];
          })
          .catch(notifyOnError);

        function notifyOnError(err) {
          Notifications.error('失败', err, '无法检索容器');
        }
      }

      function startCreationProcess(confirmed) {
        if (!confirmed) {
          return $q.when();
        }
        if (!validateAccessControl()) {
          return $q.when();
        }
        $scope.state.actionInProgress = true;
        return pullImageIfNeeded()
          .then(stopAndRenameContainer)
          .then(createNewContainer)
          .then(applyResourceControl)
          .then(connectToExtraNetworks)
          .then(removeOldContainer)
          .then(onSuccess)
          .catch(onCreationProcessFail);
      }

      function onCreationProcessFail(error) {
        var deferred = $q.defer();
        removeNewContainer()
          .then(restoreOldContainerName)
          .then(function () {
            deferred.reject(error);
          })
          .catch(function (restoreError) {
            deferred.reject(restoreError);
          });
        return deferred.promise;
      }

      function removeNewContainer() {
        return findCurrentContainer().then(function onContainerLoaded(container) {
          if (container && (!oldContainer || container.Id !== oldContainer.Id)) {
            return ContainerService.remove(container, true);
          }
        });
      }

      function restoreOldContainerName() {
        if (!oldContainer) {
          return;
        }
        return ContainerService.renameContainer(oldContainer.Id, oldContainer.Names[0].substring(1));
      }

      function confirmCreateContainer(container) {
        if (!container) {
          return $q.when(true);
        }

        return showConfirmationModal();

        function showConfirmationModal() {
          var deferred = $q.defer();

          ModalService.confirm({
            title: '你确定？',
            message: '已存在同名容器。 Portainer 可以自动删除它并重新创建一个。 你想更换它吗？',
            buttons: {
              confirm: {
                label: 'Replace',
                className: 'btn-danger',
              },
            },
            callback: function onConfirm(confirmed) {
              deferred.resolve(confirmed);
            },
          });

          return deferred.promise;
        }
      }

      function stopAndRenameContainer() {
        if (!oldContainer) {
          return $q.when();
        }
        return stopContainerIfNeeded(oldContainer).then(renameContainer);
      }

      function stopContainerIfNeeded(oldContainer) {
        if (oldContainer.State !== 'running') {
          return $q.when();
        }
        return ContainerService.stopContainer(oldContainer.Id);
      }

      function renameContainer() {
        return ContainerService.renameContainer(oldContainer.Id, oldContainer.Names[0].substring(1) + '-old');
      }

      function pullImageIfNeeded() {
        return $q.when($scope.formValues.alwaysPull && ImageService.pullImage($scope.formValues.RegistryModel, true));
      }

      function createNewContainer() {
        return $async(async () => {
          const config = prepareConfiguration();
          return await ContainerService.createAndStartContainer(config);
        });
      }

      function applyResourceControl(newContainer) {
        const userId = Authentication.getUserDetails().ID;
        const resourceControl = newContainer.Portainer.ResourceControl;
        const containerId = newContainer.Id;
        const accessControlData = $scope.formValues.AccessControlData;

        return ResourceControlService.applyResourceControl(userId, accessControlData, resourceControl).then(function onApplyResourceControlSuccess() {
          return containerId;
        });
      }

      function connectToExtraNetworks(newContainerId) {
        if (!$scope.extraNetworks) {
          return $q.when();
        }

        var connectionPromises = _.forOwn($scope.extraNetworks, function (network, networkName) {
          if (_.has(network, 'Aliases')) {
            var aliases = _.filter(network.Aliases, (o) => {
              return !_.startsWith($scope.fromContainer.Id, o);
            });
          }
          return NetworkService.connectContainer(networkName, newContainerId, aliases);
        });

        return $q.all(connectionPromises);
      }

      function removeOldContainer() {
        var deferred = $q.defer();

        if (!oldContainer) {
          deferred.resolve();
          return;
        }

        ContainerService.remove(oldContainer, true).then(notifyOnRemoval).catch(notifyOnRemoveError);

        return deferred.promise;

        function notifyOnRemoval() {
          Notifications.success('容器删除', oldContainer.Id);
          deferred.resolve();
        }

        function notifyOnRemoveError(err) {
          deferred.reject({ msg: '无法删除容器', err: err });
        }
      }

      function notifyOnError(err) {
        Notifications.error('失败', err, '无法创建容器');
      }

      function validateAccessControl() {
        var accessControlData = $scope.formValues.AccessControlData;
        return validateForm(accessControlData, $scope.isAdmin);
      }

      function onSuccess() {
        Notifications.success('容器创建成功');
        $state.go('docker.containers', {}, { reload: true });
      }
    }

    async function shouldShowDevices(isAdminOrEndpointAdmin) {
      const { allowDeviceMappingForRegularUsers } = $scope.applicationState.application;

      return allowDeviceMappingForRegularUsers || isAdminOrEndpointAdmin;
    }

    async function checkIfContainerCapabilitiesEnabled(isAdminOrEndpointAdmin) {
      const { allowContainerCapabilitiesForRegularUsers } = $scope.applicationState.application;

      return allowContainerCapabilitiesForRegularUsers || isAdminOrEndpointAdmin;
    }

    async function checkIfAdminOrEndpointAdmin() {
      if (Authentication.isAdmin()) {
        return true;
      }

      const rbacEnabled = await ExtensionService.extensionEnabled(ExtensionService.EXTENSIONS.RBAC);
      return rbacEnabled ? Authentication.hasAuthorizations(['EndpointResourcesAccess']) : false;
    }

    initView();
  },
]);
