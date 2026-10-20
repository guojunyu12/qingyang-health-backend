import {readFile} from 'node:fs/promises';
import {pool,transaction} from '../src/common/database.js';
import {foodInputs} from '../src/modules/nutrition/domain.js';
/** Explicit catalog initialization only; never invoked at application startup. */
try {
 const foods=JSON.parse(await readFile(new URL('../db/seeds/M03/foods.json',import.meta.url),'utf8'));
 await transaction(async tx=>{
  for(const food of foods){
   const {id,source,...nutrients}=food;
   foodInputs([{...nutrients,foodId:id,nutritionSource:'user',grams:100}],false);
   await tx.execute("INSERT IGNORE INTO foods(id,name,calories_per_100g,carbs_per_100g,protein_per_100g,fat_per_100g,source,status) VALUES(?,?,?,?,?,?,?,'published')",[food.id,food.name,food.caloriesKcal,food.carbsG,food.proteinG,food.fatG,food.source]);
  }
 });
 console.log('M03 catalog initialized without modifying existing foods or historical meals');
} finally {await pool.end();}
