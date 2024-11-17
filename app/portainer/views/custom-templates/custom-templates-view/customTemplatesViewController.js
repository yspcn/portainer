import _ from 'lodash-es';
import { AccessControlFormData } from 'Portainer/components/accessControlForm/porAccessControlFormModel';
import { isTemplateVariablesEnabled, renderTemplate } from '@/react/portainer/custom-templates/components/utils';
import { confirmDelete } from '@@/modals/confirm';
import { getVariablesFieldDefaultValues } from '@/react/portainer/custom-templates/components/CustomTemplatesVariablesField';
import { TEMPLATE_NAME_VALIDATION_REGEX } from '@/react/portainer/custom-templates/components/CommonFields';

class CustomTemplatesViewController {
  /* @ngInject */
  constructor(
    $anchorScroll,
    $async,
    $rootScope,
    $state,
    Authentication,
    CustomTemplateService,
    FormValidator,
    NetworkService,
    Notifications,
    ResourceControlService,
    StackService,
    StateManager
  ) {
    this.$anchorScroll = $anchorScroll;
    this.$async = $async;
    this.$rootScope = $rootScope;
    this.$state = $state;
    this.Authentication = Authentication;
    this.CustomTemplateService = CustomTemplateService;
    this.FormValidator = FormValidator;
    this.NetworkService = NetworkService;
    this.Notifications = Notifications;
    this.ResourceControlService = ResourceControlService;
    this.StateManager = StateManager;
    this.StackService = StackService;

    this.isTemplateVariablesEnabled = isTemplateVariablesEnabled;

    this.DOCKER_STANDALONE = 'DOCKER_STANDALONE';
    this.DOCKER_SWARM_MODE = 'DOCKER_SWARM_MODE';

    this.state = {
      selectedTemplate: null,
      showAdvancedOptions: false,
      formValidationError: '',
      actionInProgress: false,
      deployable: false,
      templateNameRegex: TEMPLATE_NAME_VALIDATION_REGEX,
      templateContent: '',
      templateLoadFailed: false,
    };

    this.currentUser = {
      isAdmin: false,
      id: null,
    };

    this.formValues = {
      network: '',
      name: '',
      fileContent: '',
      AccessControlData: new AccessControlFormData(),
      variables: [],
    };

    this.getTemplates = this.getTemplates.bind(this);
    this.getTemplatesAsync = this.getTemplatesAsync.bind(this);
    this.removeTemplates = this.removeTemplates.bind(this);
    this.removeTemplatesAsync = this.removeTemplatesAsync.bind(this);
    this.validateForm = this.validateForm.bind(this);
    this.createStack = this.createStack.bind(this);
    this.createStackAsync = this.createStackAsync.bind(this);
    this.selectTemplate = this.selectTemplate.bind(this);
    this.selectTemplateAsync = this.selectTemplateAsync.bind(this);
    this.unselectTemplate = this.unselectTemplate.bind(this);
    this.unselectTemplateAsync = this.unselectTemplateAsync.bind(this);
    this.getNetworks = this.getNetworks.bind(this);
    this.getNetworksAsync = this.getNetworksAsync.bind(this);
    this.confirmDelete = this.confirmDelete.bind(this);
    this.confirmDeleteAsync = this.confirmDeleteAsync.bind(this);
    this.editorUpdate = this.editorUpdate.bind(this);
    this.isEditAllowed = this.isEditAllowed.bind(this);
    this.onChangeFormValues = this.onChangeFormValues.bind(this);
    this.onChangeTemplateVariables = this.onChangeTemplateVariables.bind(this);
  }

  isEditAllowed(template) {
    return this.currentUser.isAdmin || this.currentUser.id === template.CreatedByUserId;
  }

  getTemplates() {
    return this.$async(this.getTemplatesAsync);
  }
  async getTemplatesAsync() {
    try {
      const templates = await this.CustomTemplateService.customTemplates([1, 2]);
      this.templates = templates.filter((t) => !t.EdgeTemplate);
    } catch (err) {
      this.Notifications.error('加载模板失败', err, '无法加载自定义模板');
    }
  }

  removeTemplates(templates) {
    return this.$async(this.removeTemplatesAsync, templates);
  }
  async removeTemplatesAsync(templates) {
    for (let template of templates) {
      try {
        await this.CustomTemplateService.remove(template.id);
        this.Notifications.success('成功', '模板移除成功');
        _.remove(this.templates, template);
      } catch (err) {
        this.Notifications.error('删除模板失败', err, '无法移除自定义模板');
      }
    }
  }

  onChangeTemplateVariables(variables) {
    this.onChangeFormValues({ variables });

    this.renderTemplate();
  }

  renderTemplate() {
    if (!this.isTemplateVariablesEnabled) {
      return;
    }

    const fileContent = renderTemplate(this.state.templateContent, this.formValues.variables, this.state.selectedTemplate.Variables);
    this.onChangeFormValues({ fileContent });
  }

  onChangeFormValues(values) {
    this.formValues = {
      ...this.formValues,
      ...values,
    };
  }

  validateForm(accessControlData, isAdmin) {
    this.state.formValidationError = '';
    const error = this.FormValidator.validateAccessControl(accessControlData, isAdmin);

    if (error) {
      this.state.formValidationError = error;
      return false;
    }
    return true;
  }

  createStack() {
    return this.$async(this.createStackAsync);
  }
  async createStackAsync() {
    const userId = this.currentUser.id;
    const accessControlData = this.formValues.AccessControlData;

    if (!this.validateForm(accessControlData, this.currentUser.isAdmin)) {
      return;
    }
    const stackName = this.formValues.name;

    const endpointId = this.endpoint.Id;

    this.state.actionInProgress = true;

    try {
      const file = this.formValues.fileContent;
      const createAction = this.state.selectedTemplate.Type === 1 ? this.StackService.createSwarmStackFromFileContent : this.StackService.createComposeStackFromFileContent;
      const { ResourceControl: resourceControl } = await createAction(stackName, file, [], endpointId);
      await this.ResourceControlService.applyResourceControl(userId, accessControlData, resourceControl);
      this.Notifications.success('成功', '堆栈部署成功');
      this.$state.go('docker.stacks');
    } catch (err) {
      this.Notifications.error('部署错误', err, '堆栈部署失败');
    } finally {
      this.state.actionInProgress = false;
    }
  }

  unselectTemplate() {
    // wrapping unselect with async to make a digest cycle run between unselect to select
    return this.$async(this.unselectTemplateAsync);
  }
  async unselectTemplateAsync() {
    this.state.selectedTemplate = null;

    this.formValues = {
      network: '',
      name: '',
      fileContent: '',
      AccessControlData: new AccessControlFormData(),
      variables: [],
    };
  }

  selectTemplate(templateId) {
    return this.$async(this.selectTemplateAsync, templateId);
  }
  async selectTemplateAsync(templateId) {
    if (this.state.selectedTemplate) {
      await this.unselectTemplate(this.state.selectedTemplate);
    }

    const template = _.find(this.templates, { Id: templateId });

    const isGit = template.GitConfig !== null;
    this.state.isEditorReadOnly = isGit;

    try {
      this.state.templateContent = this.formValues.fileContent = await this.CustomTemplateService.customTemplateFile(template.Id, template.GitConfig !== null);
    } catch (err) {
      this.state.templateLoadFailed = true;
      this.Notifications.error('失败', err, '无法获取自定义模板数据');
    }

    this.formValues.network = _.find(this.availableNetworks, function (o) {
      return o.Name === 'bridge';
    });

    this.formValues.name = '';
    this.state.selectedTemplate = template;
    this.$anchorScroll('view-top');
    const applicationState = this.StateManager.getState();
    this.state.deployable = this.isDeployable(applicationState.endpoint, template.Type);

    if (template.Variables && template.Variables.length > 0) {
      const variables = getVariablesFieldDefaultValues(template.Variables);
      this.onChangeTemplateVariables(variables);
    }
  }

  getNetworks(provider, apiVersion) {
    return this.$async(this.getNetworksAsync, provider, apiVersion);
  }
  async getNetworksAsync(provider, apiVersion) {
    try {
      const networks = await this.NetworkService.networks(
        provider === 'DOCKER_STANDALONE' || provider === 'DOCKER_SWARM_MODE',
        false,
        provider === 'DOCKER_SWARM_MODE' && apiVersion >= 1.25
      );
      this.availableNetworks = networks;
    } catch (err) {
      this.Notifications.error('失败', err, '加载网络失败');
    }
  }

  confirmDelete(templateId) {
    return this.$async(this.confirmDeleteAsync, templateId);
  }
  async confirmDeleteAsync(templateId) {
    const confirmed = await confirmDelete('您确定要删除此模板吗？');
    if (!confirmed) {
      return;
    }

    try {
      var template = _.find(this.templates, { Id: templateId });
      await this.CustomTemplateService.remove(templateId);
      this.Notifications.success('模板删除成功', template && template.Title);
      this.templates = this.templates.filter((template) => template.Id !== templateId);
    } catch (err) {
      this.Notifications.error('失败', err, '删除模板失败');
    }
  }

  editorUpdate(value) {
    this.formValues.fileContent = value;
  }

  isDeployable(endpoint, templateType) {
    let deployable = false;
    switch (templateType) {
      case 1:
        deployable = endpoint.mode.provider === this.DOCKER_SWARM_MODE;
        break;
      case 2:
        deployable = endpoint.mode.provider === this.DOCKER_STANDALONE;
        break;
    }

    return deployable;
  }

  $onInit() {
    const applicationState = this.StateManager.getState();

    const {
      endpoint: { mode: endpointMode },
      apiVersion,
    } = applicationState;

    this.getTemplates();
    this.getNetworks(endpointMode.provider, apiVersion);

    this.currentUser.isAdmin = this.Authentication.isAdmin();
    const user = this.Authentication.getUserDetails();
    this.currentUser.id = user.ID;
  }
}

export default CustomTemplatesViewController;