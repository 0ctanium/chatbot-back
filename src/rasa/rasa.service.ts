import { Injectable } from '@nestjs/common';
import { IntentService } from "../intent/intent.service";
import { Intent } from "@core/entities/intent.entity";
import { RasaNluModel } from "@core/models/rasa-nlu.model";
import { RasaButtonModel, RasaDomainModel, RasaUtterResponseModel } from "@core/models/rasa-domain.model";
import { Response } from "@core/entities/response.entity";
import { ResponseType } from "@core/enums/response-type.enum";
import { execShellCommand } from "@core/utils";
import * as path from "path";
import { ChatbotConfigService } from "../chatbot-config/chatbot-config.service";
import { ChatbotConfig } from "@core/entities/chatbot-config.entity";
import { In, Not } from "typeorm";
import { IntentStatus } from "@core/enums/intent-status.enum";

const fs = require('fs');
const yaml = require('js-yaml');

@Injectable()
export class RasaService {

  private _chatbotTemplateDir = path.resolve(__dirname, '../../../chatbot-template');

  constructor(private readonly _intentService: IntentService,
              private readonly _configService: ChatbotConfigService) {
  }

  async isRasaTraining() {
    const chatbotConfig: ChatbotConfig = await this._configService.getChatbotConfig();
    return chatbotConfig.training_rasa;
  }

  async generateFiles() {
    const intents: Intent[] = await this._intentService.findFullIntents();
    this._intentsToRasa(intents);
  }

  async trainRasa() {
    await this._configService.update(<ChatbotConfig>{training_rasa: true});
    try {
      await execShellCommand(`rasa train --augmentation 0`, this._chatbotTemplateDir).then(res => {
        console.log(`${new Date().toLocaleString()} - TRAINING RASA`);
        console.log(res);
      });
      await execShellCommand(`pkill screen`, this._chatbotTemplateDir).then(res => {
        console.log(`${new Date().toLocaleString()} - KILLING SCREEN`);
        console.log(res);
      });
      await execShellCommand(`screen -S rasa -dmS rasa run -m models --enable-api --log-file out.log --cors "*" --debug`, this._chatbotTemplateDir).then(res => {
        console.log(`${new Date().toLocaleString()} - LAUNCHING SCREEN`);
        console.log(res);
      });
      await this._intentService.updateManyByCondition({status: In([IntentStatus.to_deploy, IntentStatus.active])}, {status: IntentStatus.active});
      await this._intentService.updateManyByCondition({status: IntentStatus.to_archive}, {status: IntentStatus.archived});
    } catch(e) {
    }
    await this._configService.update(<ChatbotConfig>{training_rasa: false});
  }

  /**
   * PRIVATE FUNCTIONS
   */

  /**
   * Converti des intents dans les 3 fichiers de Rasa
   * @param intents
   * @private
   */
  private _intentsToRasa(intents: Intent[]) {
    const nlu = new RasaNluModel();
    const domain = new RasaDomainModel();
    let stories: string = '';

    domain.intents = intents.map(i => i.id);
    intents.forEach(intent => {
      // Fill NLU
      const commonExamples = nlu.rasa_nlu_data.common_examples;
      commonExamples.push({intent: intent.id, text: intent.id});
      if (intent.main_question) {
        commonExamples.push({intent: intent.id, text: intent.main_question});
      }
      intent.knowledges.forEach(knowledge => {
        commonExamples.push({intent: intent.id, text: knowledge.question});
      });

      // Fill DOMAINS & STORIES
      const responses = this._generateDomainUtter(intent);
      stories += this._generateStory(Object.keys(responses), intent.id);
      domain.responses = Object.assign(responses, domain.responses);
    });

    fs.writeFileSync(`${this._chatbotTemplateDir}/data/nlu.json`, JSON.stringify(nlu), 'utf8');
    fs.writeFileSync(`${this._chatbotTemplateDir}/domain.yml`, yaml.safeDump(domain), 'utf8');
    fs.writeFileSync(`${this._chatbotTemplateDir}/data/stories.md`, stories, 'utf8');
  }

  /**
   * Génération des réponses (utter) pour un intent donné
   * @param intent
   */
  private _generateDomainUtter(intent: Intent): { [key: string]: RasaUtterResponseModel[] } {
    const responses: { [key: string]: RasaUtterResponseModel[] } = {};
    intent.responses.forEach((response: Response, index: number) => {
      switch (response.response_type) {
        case ResponseType.text:
          responses[`utter_${intent.id}_${index}`] = [{text: response.response}];
          break;
        case ResponseType.image:
          responses[`utter_${intent.id}_${index - 1}`][0].image = response.response;
          break;
        case ResponseType.button:
          const buttons: string[] = response.response.split(';');
          responses[`utter_${intent.id}_${index - 1}`][0].buttons = [];
          let utter_buttons = responses[`utter_${intent.id}_${index - 1}`][0].buttons;
          buttons.forEach(button => {
            utter_buttons.push(new RasaButtonModel(button));
          });
          responses[`utter_${intent.id}_${index - 1}`][0].buttons = [new RasaButtonModel(response.response)];
          break;
        case ResponseType.quick_reply:
          const quick_replies: string[] = response.response.split(';');
          responses[`utter_${intent.id}_${index - 1}`][0].buttons = [];
          let utter_buttons_bis = responses[`utter_${intent.id}_${index - 1}`][0].buttons;
          quick_replies.forEach(quick_reply => {
            utter_buttons_bis.push(new RasaButtonModel(quick_reply));
          });
          break;
      }
    });
    return responses;
  }

  /**
   * Generate a story in Markdown format from utters of an intent
   * @param utters
   * @param intentId
   */
  private _generateStory(utters: string[], intentId: string): string {
    let story = `## ${intentId}`;
    story += `\n* ${intentId}`;
    utters.forEach(utter => {
      story += `\n  - ${utter}`;
    });
    story += `\n\n`;
    return story;
  }
}