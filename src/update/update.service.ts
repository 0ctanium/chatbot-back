import { Injectable } from '@nestjs/common';
import { UpdateChatbotDto } from "@core/dto/update-chatbot.dto";
import { AnsiblePlaybook, Options } from "ansible-playbook-cli-js";
import { ChatbotConfigService } from "../chatbot-config/chatbot-config.service";
import * as fs from "fs";

@Injectable()
export class UpdateService {

  private _appDir = '/var/www/chatbot-back';
  private _gitDir = '/var/www/git/chatbot-back';

  constructor(private _configService: ChatbotConfigService) {
  }

  async update(updateChatbot: UpdateChatbotDto, files) {
    console.log('Updating Chatbot...', updateChatbot);
    await this._updateChatbotRepos(updateChatbot);
    const chatbotConfig = await this._configService.getChatbotConfig();

    if (files && files.env && files.env[0]) {
      fs.writeFileSync(`${this._appDir}/../git/.env`, files.env[0], 'utf8');
    }
    if (files && files.nginx_conf && files.nginx_conf[0]) {
      fs.writeFileSync(`/etc/nginx.conf`, files.nginx_conf[0], 'utf8');
    }
    if (files && files.nginx_site && files.nginx_site[0]) {
      fs.writeFileSync(`/etc/nginx_conf.cfg`, files.nginx_site[0], 'utf8');
    }

    const playbookOptions = new Options(`${this._gitDir}/ansible`);
    const ansiblePlaybook = new AnsiblePlaybook(playbookOptions);
    const extraVars = {...updateChatbot, ...{botDomain: chatbotConfig.domain_name}};
    await ansiblePlaybook.command(`generate-chatbot.yml -e '${JSON.stringify(extraVars)}'`).then(async (result) => {
      console.log(`${new Date().toLocaleString()} - CHATBOT UPDATED`);
      console.log(result);
      if(updateChatbot.updateBack) {
        await ansiblePlaybook.command(`reload-back.yml -e '${JSON.stringify(extraVars)}'`).then((result) => {
          console.log(result);
        })
      }
    }).catch(() => {
      console.error(`${new Date().toLocaleString()} - ERROR UPDATING CHATBOT`);
    });
  }

  private async _updateChatbotRepos(updateChatbot: UpdateChatbotDto) {
    const playbookOptions = new Options(`${this._gitDir}/ansible`);
    const ansiblePlaybook = new AnsiblePlaybook(playbookOptions);
    const extraVars = {
      frontBranch: updateChatbot.frontBranch,
      backBranch: updateChatbot.backBranch,
      botBranch: updateChatbot.botBranch
    };
    await ansiblePlaybook.command(`update-chatbot-repo.yml -e '${JSON.stringify(extraVars)}'`).then(async (result) => {
      console.log(`${new Date().toLocaleString()} - UPDATING CHATBOTS REPOSITORIES`);
      console.log(result);
    }).catch(error => {
      console.error(`${new Date().toLocaleString()} - ERRROR UPDATING CHATBOTS REPOSITORIES`);
    });
  }
}
